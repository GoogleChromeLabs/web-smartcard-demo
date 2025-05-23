/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as apdu from './apdu';
import * as piv from './piv';

// --- Mocks for Smart Card API ---
const mockSmartCardConnection = {
  startTransaction: jest.fn(),
  disconnect: jest.fn(),
  transmit: jest.fn(),
};

const mockSmartCardContext = {
  listReaders: jest.fn(),
  connect: jest.fn(), // Will be configured per test
  getStatusChange: jest.fn().mockResolvedValue([]), // Default for tracking
};

const mockSmartCardResourceManager = {
  establishContext: jest.fn().mockResolvedValue(mockSmartCardContext),
};

// --- Helper to create ArrayBuffer from hex string ---
function hexToArrayBuffer(hex: string): ArrayBuffer {
  if (hex.length % 2 !== 0) throw new Error("Hex string must have an even number of characters");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

// --- Mock PIV / Certificate Data ---
// This is a placeholder for raw certificate bytes.
const MOCK_RAW_CERT_BYTES = hexToArrayBuffer("3082010A020101"); // Minimal ASN.1 structure

const MOCK_CERT_DATA_FOR_BER_GETVALUE = MOCK_RAW_CERT_BYTES;

// Helper to construct BER-TLV for mock data
function constructBerTlv(tag: number, valueBytes: Uint8Array): ArrayBuffer {
  let lengthBytes: number[];
  if (valueBytes.byteLength < 128) {
    lengthBytes = [valueBytes.byteLength];
  } else if (valueBytes.byteLength < 256) {
    lengthBytes = [0x81, valueBytes.byteLength];
  } else { // valueBytes.byteLength < 65536
    lengthBytes = [0x82, valueBytes.byteLength >> 8, valueBytes.byteLength & 0xFF];
  }
  const tempArray = new Uint8Array([tag, ...lengthBytes, ...valueBytes]);
  return tempArray.buffer;
}

// This is what ber.getValue(certObject, piv.Tag.Certificate) should return.
// Construct the `certObject` that _internalReadCertificateData expects from fetchObject.
const certObjectBerPayload = constructBerTlv(piv.Tag.Certificate, new Uint8Array(MOCK_CERT_DATA_FOR_BER_GETVALUE));
// This `certObjectBerPayload` is what `fetchObject(conn, piv.ObjectTag.CertificateForCardAuthentication)`
// should resolve to in the happy path for _internalReadCertificateData.

// Now, construct the data that `transmit` (for GET DATA) should return.
// This data is `certObjectBerPayload` wrapped in an `apdu.DiscretionaryData` TLV.
const transmitGetDataPayload = constructBerTlv(apdu.DiscretionaryData, new Uint8Array(certObjectBerPayload));


// --- APDU Responses ---
const SW_SUCCESS = new Uint8Array([0x90, 0x00]).buffer;
const SW_FILE_NOT_FOUND = new Uint8Array([0x6A, 0x82]).buffer; // Example error

const SELECT_PIV_SUCCESS_RESPONSE = Promise.resolve(SW_SUCCESS);

const GET_DATA_CERT_SUCCESS_RESPONSE_ARRAY = [...new Uint8Array(transmitGetDataPayload), 0x90, 0x00];
const GET_DATA_CERT_SUCCESS_RESPONSE = Promise.resolve(new Uint8Array(GET_DATA_CERT_SUCCESS_RESPONSE_ARRAY).buffer);


// --- Mock @peculiar/x509 ---
jest.mock('@peculiar/x509', () => ({
  X509Certificate: jest.fn().mockImplementation((_rawData) => ({
    serialNumber: 'test-serial-number',
    subject: 'CN=Test Subject',
    issuer: 'CN=Test Issuer',
    notBefore: new Date('2023-01-01T00:00:00Z'),
    notAfter: new Date('2024-01-01T00:00:00Z'),
    signature: hexToArrayBuffer("0102030405"),
    signatureAlgorithm: { name: 'SHA256withRSA' },
    publicKey: {
      algorithm: { name: 'RSAPublicKey' },
      toString: () => '-----BEGIN PUBLIC KEY-----\nTESTKEY\n-----END PUBLIC KEY-----',
    },
  })),
}));


// --- Test Helper Utilities ---
async function awaitUpdate(delay = 100) {
  await new Promise(resolve => setTimeout(resolve, delay));
}

// --- Test Setup Utilities ---
// Helper to ensure a fresh module and DOM for each test
async function initializeTestEnvironment() {
  document.body.innerHTML = `
    <button id="refresh-readers">Refresh Readers</button>
    <button id="track-readers">Start tracking readers</button>
    <div id="readers-list"></div>
  `;

  // Dynamically import the module to run its top-level code (like attaching DOMContentLoaded)
  // jest.isolateModules ensures a fresh instance.
  await jest.isolateModulesAsync(async () => {
    await import('./index');
  });

  // Dispatch DOMContentLoaded to trigger the app's initialization
  const event = new Event('DOMContentLoaded', { bubbles: true, cancelable: true });
  document.dispatchEvent(event);

  // Allow microtasks and short timers to complete (e.g., async operations in init)
  await awaitUpdate();
}

// Helper to get reader UI elements
function getReaderUI(readerName: string) {
  const readersList = document.getElementById('readers-list') as HTMLDivElement;
  const readerDiv = Array.from(readersList.children).find(child => {
    const span = child.querySelector('p > span');
    return span && (span as HTMLSpanElement).innerText === readerName;
  }) as HTMLDivElement | undefined;

  if (!readerDiv) return null;

  return {
    div: readerDiv,
    connectButton: readerDiv.querySelector('p > button:nth-of-type(1)') as HTMLButtonElement,
    disconnectButton: readerDiv.querySelector('p > button:nth-of-type(2)') as HTMLButtonElement,
    readCertButton: readerDiv.querySelector('p > button:nth-of-type(3)') as HTMLButtonElement,
    certDiv: readerDiv.querySelector('div:nth-of-type(1)') as HTMLDivElement,
  };
}


// --- Global Mocks Setup ---
beforeAll(() => {
  // @ts-ignore
  global.navigator.smartCard = mockSmartCardResourceManager;
});


describe('Smart Card Demo UI', () => {
  beforeEach(async () => {
    // Reset all mocks and the DOM environment before each test
    jest.clearAllMocks();
    // Provide a default mock for listReaders to prevent TypeErrors if index.ts calls it early
    // (e.g., on DOMContentLoaded before a test-specific mock is set).
    mockSmartCardContext.listReaders.mockResolvedValue([]);

    mockSmartCardContext.connect.mockResolvedValue({ // Default success for connect
      connection: mockSmartCardConnection,
      activeProtocol: 't1',
    });
    mockSmartCardConnection.disconnect.mockResolvedValue(undefined); // Default success for disconnect
    mockSmartCardConnection.startTransaction.mockImplementation(async (callback) => callback()); // Default pass-through

    // Default transmit logic: success for SELECT PIV, success for GET DATA (cert)
    mockSmartCardConnection.transmit.mockImplementation(async (sendBuffer) => {
      // Simple check based on instruction byte is sufficient for these tests
      const bytes = new Uint8Array(sendBuffer as ArrayBuffer);
      if (bytes[1] === apdu.Instruction.Select) { // Check INS byte for SELECT
        return SELECT_PIV_SUCCESS_RESPONSE;
      }
      if (bytes[1] === apdu.Instruction.GetData) { // Check INS byte for GET DATA
        return GET_DATA_CERT_SUCCESS_RESPONSE;
      }
      throw new Error(`Mock transmit unhandled APDU INS: 0x${bytes[1].toString(16)}`);
    });


    await initializeTestEnvironment();
  });

  test('should display "No smart card readers available" initially after refresh', async () => {
    mockSmartCardContext.listReaders.mockResolvedValue([]);
    const refreshButton = document.getElementById('refresh-readers') as HTMLButtonElement;
    refreshButton.click();

    await awaitUpdate();

    const readersList = document.getElementById('readers-list') as HTMLDivElement;
    expect(readersList.innerText).toBe("No smart card readers available.");
  });

  describe('With a single reader', () => {
    const readerName = "Test Reader 1";

    beforeEach(async () => {
      mockSmartCardContext.listReaders.mockResolvedValue([readerName]);
      const refreshButton = document.getElementById('refresh-readers') as HTMLButtonElement;
      refreshButton.click();
      await awaitUpdate();
    });

    test('should display the reader and correct initial button states', () => {
      const ui = getReaderUI(readerName);
      expect(ui).not.toBeNull();
      expect(ui?.connectButton.disabled).toBe(false);
      expect(ui?.disconnectButton.disabled).toBe(true);
      expect(ui?.readCertButton.disabled).toBe(true);
      expect(ui?.certDiv.childNodes.length).toBe(0);
    });

    test('Connect button should establish connection and update UI', async () => {
      const ui = getReaderUI(readerName)!;
      ui.connectButton.click();
      await awaitUpdate();

      expect(mockSmartCardContext.connect).toHaveBeenCalledWith(readerName, "shared", { preferredProtocols: ["t1"] });
      expect(ui.connectButton.disabled).toBe(true);
      expect(ui.disconnectButton.disabled).toBe(false);
      expect(ui.readCertButton.disabled).toBe(false);
      expect((ui.certDiv.childNodes[0] as HTMLParagraphElement).innerText).toContain("Connected with protocol: t1");
    });

    test('Connect button should show error if connection fails', async () => {
      mockSmartCardContext.connect.mockRejectedValue(new Error("Connection Failed"));
      const ui = getReaderUI(readerName)!;
      ui.connectButton.click();
      await awaitUpdate();

      expect(ui.connectButton.disabled).toBe(false);
      expect(ui.disconnectButton.disabled).toBe(true);
      expect(ui.readCertButton.disabled).toBe(true);
      expect((ui.certDiv.childNodes[0] as HTMLParagraphElement).innerText).toContain("Error: Connection failed: Connection Failed");
    });

    describe('When connected', () => {
      beforeEach(async () => {
        const ui = getReaderUI(readerName)!;
        ui.connectButton.click();
        await awaitUpdate();
      });

      test('Disconnect button should terminate connection and update UI', async () => {
        const ui = getReaderUI(readerName)!;
        ui.disconnectButton.click();
        await awaitUpdate();

        expect(mockSmartCardConnection.disconnect).toHaveBeenCalled();
        expect(ui.connectButton.disabled).toBe(false);
        expect(ui.disconnectButton.disabled).toBe(true);
        expect(ui.readCertButton.disabled).toBe(true);
        expect((ui.certDiv.childNodes[0] as HTMLParagraphElement).innerText).toContain("Disconnected.");
      });

      test('Disconnect button should handle errors and update UI', async () => {
        mockSmartCardConnection.disconnect.mockRejectedValue(new Error("Disconnect Syscall Failed"));
        const ui = getReaderUI(readerName)!;
        ui.disconnectButton.click();
        await awaitUpdate();

        expect(ui.connectButton.disabled).toBe(false);
        expect(ui.disconnectButton.disabled).toBe(true);
        expect(ui.readCertButton.disabled).toBe(true);
        // cleanupReaderConnectionAndUI is called, which resets state and may show secondary errors.
        // For now, we check the state.
        expect(ui.certDiv.textContent).not.toContain("Connected"); // Ensure old messages are cleared
      });

      test('Read Certificate button should display certificate on success', async () => {
        const ui = getReaderUI(readerName)!;
        ui.readCertButton.click();
        await awaitUpdate();

        expect(mockSmartCardConnection.startTransaction).toHaveBeenCalled();
        expect(mockSmartCardConnection.transmit).toHaveBeenCalledTimes(2); // SELECT PIV, GET DATA
        const table = ui.certDiv.childNodes[0] as HTMLTableElement;
        expect(table.rows[0].cells[0].innerText).toContain("X.509 Certificate for Card Authentication");
        expect(table.rows[1].cells[1].innerText).toContain("test-serial-number");
        // Buttons should remain in connected state
        expect(ui.connectButton.disabled).toBe(true);
        expect(ui.disconnectButton.disabled).toBe(false);
        expect(ui.readCertButton.disabled).toBe(false);
      });

      test('Read Certificate should handle transmit error (e.g., SELECT PIV fails)', async () => {
        mockSmartCardConnection.transmit.mockImplementationOnce(async (sendBuffer) => { // For SELECT PIV
          const bytes = new Uint8Array(sendBuffer as ArrayBuffer);
          if (bytes[1] === apdu.Instruction.Select) {
            return Promise.resolve(SW_FILE_NOT_FOUND); // PIV app not found
          }
          throw new Error("Unexpected APDU in failing SELECT mock");
        });
        // Subsequent GET DATA should not be called if SELECT fails and throws.

        const ui = getReaderUI(readerName)!;
        ui.readCertButton.click();
        await awaitUpdate();

        expect((ui.certDiv.childNodes[0] as HTMLParagraphElement).innerText).toContain("Error: Failed to read certificate: Failed to select PIV application: SW=0x6a82");
        // Connection should be dropped
        expect(ui.connectButton.disabled).toBe(false);
        expect(ui.disconnectButton.disabled).toBe(true);
        expect(ui.readCertButton.disabled).toBe(true);
      });

      test('Read Certificate should handle error if _internalReadCertificateData throws (e.g. cert object empty)', async () => {
        // Make fetchObject (via transmit for GET DATA) return an empty certObject payload
        mockSmartCardConnection.transmit.mockImplementation(async (sendBuffer) => {
          const bytes = new Uint8Array(sendBuffer as ArrayBuffer);
          if (bytes[1] === apdu.Instruction.Select) return SELECT_PIV_SUCCESS_RESPONSE;
          if (bytes[1] === apdu.Instruction.GetData) {
            // Return data that will result in ber.getValue(certObject, piv.Tag.Certificate) failing
            // or certObject itself being empty after apdu.DiscretionaryData stripping.
            // E.g., an empty DiscretionaryData payload.
            const emptyDiscretionaryData = new Uint8Array([apdu.DiscretionaryData, 0x00]);
            const response = new Uint8Array([...emptyDiscretionaryData, 0x90, 0x00]);
            return Promise.resolve(response.buffer);
          }
          throw new Error("Unhandled APDU in empty cert mock");
        });

        const ui = getReaderUI(readerName)!;
        ui.readCertButton.click();
        await awaitUpdate();

        // The error comes from ber.getValue or the check certObject.byteLength === 0
        expect((ui.certDiv.childNodes[0] as HTMLParagraphElement).innerText).toMatch(/Error: Failed to read certificate:.*(Invalid GET DATA response from PIV app|Could not find tag 0x70|Card does not have a X.509 Certificate)/);
        expect(ui.connectButton.disabled).toBe(false);
        expect(ui.disconnectButton.disabled).toBe(true);
        expect(ui.readCertButton.disabled).toBe(true);
      });
    });
  });

  // Add more tests for multiple readers, reader removal while connected, etc.
});

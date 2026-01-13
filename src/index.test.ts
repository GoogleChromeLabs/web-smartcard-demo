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

// --- Global Mocks Setup ---
beforeAll(() => {
  // @ts-ignore
  global.navigator.smartCard = mockSmartCardResourceManager;
  global.fetch = jest.fn();
});

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
async function waitFor(condition: () => boolean | Promise<boolean>, timeout = 1000, interval = 10) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error("Timeout waiting for condition");
}

// --- Test Setup Utilities ---
// Helper to ensure a fresh module and DOM for each test
async function initializeTestEnvironment() {
  document.body.innerHTML = `
    <p>
      <button id="refresh-readers">Refresh Readers</button>
      <button id="track-readers">Start tracking readers</button>
    </p>
    <div id="readers-list"></div>
  `;

  // Require index.ts to run its top-level code (event listeners)
  // Since we use jest.resetModules(), this will re-execute the module
  const indexModule = require('./index');

  // Trigger DOMContentLoaded to initialize the app
  const event = new Event('DOMContentLoaded', { bubbles: true, cancelable: true });
  document.dispatchEvent(event);

  // Wait for the application to initialize by checking for UI updates.
  // The app will either populate the list with readers or show a "No readers" message.
  await waitFor(() => {
    const list = document.getElementById('readers-list');
    return list !== null && (list.children.length > 0 || list.textContent !== "");
  });

  return indexModule;
}

// Helper to get reader UI elements
function getReaderUI(readerName: string) {
  const readersList = document.getElementById('readers-list') as HTMLDivElement;
  const readerDiv = Array.from(readersList.children).find(child => {
    const span = child.querySelector('p > span');
    return span && (span as HTMLSpanElement).textContent === readerName;
  }) as HTMLDivElement | undefined;

  if (!readerDiv) return null;

  return {
    div: readerDiv,
    connectButton: readerDiv.querySelector('p > button:nth-of-type(1)') as HTMLButtonElement,
    disconnectButton: readerDiv.querySelector('p > button:nth-of-type(2)') as HTMLButtonElement,
    readCertButton: readerDiv.querySelector('p > button:nth-of-type(3)') as HTMLButtonElement,
    atrDiv: readerDiv.querySelector('div:nth-of-type(1)') as HTMLDivElement,
    certDiv: readerDiv.querySelector('div:nth-of-type(2)') as HTMLDivElement,
  };
}

describe('Smart Card Demo UI', () => {
  let app: any;

  beforeEach(async () => {
    // Reset all mocks and the DOM environment before each test
    jest.resetModules(); // CRITICAL: Reset module registry for each test
    jest.clearAllMocks();

    // Set up a default successful mock for fetch BEFORE the app initializes
    (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
    });

    // Provide a default mock for listReaders to prevent TypeErrors if index.ts calls it early
    // (e.g., on DOMContentLoaded before a test-specific mock is set).
    mockSmartCardContext.listReaders.mockResolvedValue([]);

    mockSmartCardContext.connect.mockResolvedValue({ // Default success for connect
      connection: mockSmartCardConnection,
      activeProtocol: 't1',
    });
    mockSmartCardConnection.disconnect.mockResolvedValue(undefined); // Default success for disconnect
    mockSmartCardConnection.startTransaction.mockImplementation(async (callback: any) => callback()); // Default pass-through

    // Default transmit logic: success for SELECT PIV, success for GET DATA (cert)
    mockSmartCardConnection.transmit.mockImplementation(async (sendBuffer: any) => {
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
  });

  test('should display "No smart card readers available" initially after refresh', async () => {
    mockSmartCardContext.listReaders.mockResolvedValue([]);
    await initializeTestEnvironment();

    const readersList = document.getElementById('readers-list') as HTMLDivElement;
    await waitFor(() => readersList.textContent === "No smart card readers available.");
  });

  describe('With a single reader', () => {
    const readerName = "Test Reader 1";

    beforeEach(async () => {
      mockSmartCardContext.listReaders.mockResolvedValue([readerName]);
      app = await initializeTestEnvironment();
    });

    test('should display the reader and correct initial button states', async () => {
      await waitFor(() => getReaderUI(readerName) !== null);
      const ui = getReaderUI(readerName);
      expect(ui).not.toBeNull();
      expect(ui?.connectButton.disabled).toBe(false);
      expect(ui?.disconnectButton.disabled).toBe(true);
      expect(ui?.readCertButton.disabled).toBe(true);
    });

    test('should display ATR when reader is detected', async () => {
      jest.resetModules(); // Reset to ensure fresh module load with new mock
      const atrBuffer = new Uint8Array([0x3B, 0x01, 0x02]).buffer;
      mockSmartCardContext.getStatusChange.mockResolvedValue([{
        readerName: readerName,
        eventState: { present: true },
        eventCount: 1,
        answerToReset: atrBuffer
      }]);

      // Re-initialize to trigger refreshReadersList with the new mock
      app = await initializeTestEnvironment();

      await waitFor(() => getReaderUI(readerName) !== null);
      const ui = getReaderUI(readerName)!;

      // Check for ATR hex string
      await waitFor(() => ui.atrDiv.textContent?.includes("ATR: 3B 01 02") ?? false);
    });

    test('Refresh should update ATR for existing reader with card', async () => {
      const atrBuffer = new Uint8Array([0x3B, 0x01, 0x02]).buffer;
      mockSmartCardContext.getStatusChange.mockResolvedValue([{
        readerName: readerName,
        eventState: { present: true },
        eventCount: 1,
        answerToReset: atrBuffer
      }]);

      app = await initializeTestEnvironment();
      await waitFor(() => getReaderUI(readerName) !== null);
      const ui = getReaderUI(readerName)!;
      await waitFor(() => ui.atrDiv.textContent?.includes("ATR: 3B 01 02") ?? false);

      // Clear ATR manually to verify refresh restores it (or simply verify refresh maintains it)
      ui.atrDiv.textContent = "";

      // Trigger refresh
      const refreshButton = document.getElementById('refresh-readers') as HTMLButtonElement;
      refreshButton.click();

      // Should show ATR again
      await waitFor(() => ui.atrDiv.textContent?.includes("ATR: 3B 01 02") ?? false);
    });

    test('Connect button should establish connection and update UI', async () => {
      await waitFor(() => getReaderUI(readerName) !== null);
      const ui = getReaderUI(readerName)!;
      ui.connectButton.click();

      await waitFor(() => ui.disconnectButton.disabled === false);

      expect(mockSmartCardContext.connect).toHaveBeenCalledWith(readerName, "shared", { preferredProtocols: ["t1"] });
      expect(ui.connectButton.disabled).toBe(true);
      expect(ui.disconnectButton.disabled).toBe(false);
      expect(ui.readCertButton.disabled).toBe(false);
      expect((ui.certDiv.childNodes[0] as HTMLParagraphElement).textContent).toContain("Connected with protocol: t1");
    });

    test('Connect button should show error if connection fails', async () => {
      mockSmartCardContext.connect.mockRejectedValue(new Error("Connection Failed"));
      await waitFor(() => getReaderUI(readerName) !== null);
      const ui = getReaderUI(readerName)!;
      ui.connectButton.click();

      await waitFor(() => ui.certDiv.textContent?.includes("Error"));

      expect(ui.connectButton.disabled).toBe(false);
      expect(ui.disconnectButton.disabled).toBe(true);
      expect(ui.readCertButton.disabled).toBe(true);
      expect((ui.certDiv.childNodes[0] as HTMLParagraphElement).textContent).toContain("Error: Connection failed: Connection Failed");
    });

    describe('When connected', () => {
      beforeEach(async () => {
        await waitFor(() => getReaderUI(readerName) !== null);
        const ui = getReaderUI(readerName)!;
        ui.connectButton.click();
        await waitFor(() => ui.disconnectButton.disabled === false);
      });

      test('Disconnect button should terminate connection and update UI', async () => {
        const ui = getReaderUI(readerName)!;
        ui.disconnectButton.click();

        await waitFor(() => ui.connectButton.disabled === false);

        expect(mockSmartCardConnection.disconnect).toHaveBeenCalled();
        expect(ui.disconnectButton.disabled).toBe(true);
        expect(ui.readCertButton.disabled).toBe(true);
        expect((ui.certDiv.childNodes[0] as HTMLParagraphElement).textContent).toContain("Disconnected.");
      });

      test('Read Certificate button should display certificate on success', async () => {
        const ui = getReaderUI(readerName)!;
        ui.readCertButton.click();

        await waitFor(() => ui.certDiv.querySelector('table') !== null);

        expect(mockSmartCardConnection.startTransaction).toHaveBeenCalled();
        expect(mockSmartCardConnection.transmit).toHaveBeenCalledTimes(2);
        const table = ui.certDiv.childNodes[0] as HTMLTableElement;
        expect(table.rows[0].cells[0].textContent).toContain("X.509 Certificate for Card Authentication");
        expect(table.rows[1].cells[1].textContent).toContain("test-serial-number");
      });
    });
  });
});

describe('ATR Parsing and Matching', () => {
  let module: any;

  beforeEach(async () => {
    jest.resetModules();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    module = require('./index');
  });

  describe('fetchAndParseAtrList', () => {
    test('should parse a valid ATR list correctly', async () => {
      const mockAtrList = `
# Comment line that should be ignored

3B A7 00 40 18 C8 40 13 01 90 00
	Card A - Type 1
	Card A - Subtype 2

# Another comment
3B FA 11 00 .. .. 81 31 FE 45 .. .. .. .. .. .. .. .. .. ..
	Card B - Complex with wildcards
`;
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockAtrList),
      });

      const atrMap = await module.fetchAndParseAtrList();

      expect(atrMap.size).toBe(2);
      expect(atrMap.has('3BA7004018C84013019000')).toBe(true);
      expect(atrMap.get('3BA7004018C84013019000')).toEqual([
        'Card A - Type 1',
        'Card A - Subtype 2',
      ]);
      expect(atrMap.has('3BFA1100....8131FE45....................')).toBe(true);
      expect(atrMap.get('3BFA1100....8131FE45....................')).toEqual([
        'Card B - Complex with wildcards',
      ]);
    });

    test('should throw an error if fetch fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      });
      await expect(module.fetchAndParseAtrList()).rejects.toThrow('Failed to fetch ATR list: Not Found');
    });
  });

  describe('matchAtr', () => {
    const atrMap = new Map<string, string[]>();
    atrMap.set('3B010203', ['Exact Match Card']);
    atrMap.set('3B..0405', ['Wildcard Match Card']); // two wildcards

    test('should return descriptions for an exact ATR match', () => {
      const matches = module.matchAtr('3B010203', atrMap);
      expect(matches).toEqual(['Exact Match Card']);
    });

    test('should return descriptions for a wildcard ATR match', () => {
      const matches = module.matchAtr('3BFF0405', atrMap);
      expect(matches).toEqual(['Wildcard Match Card']);
    });

    test('should return null if no match is found', () => {
      const matches = module.matchAtr('3B010299', atrMap);
      expect(matches).toBeNull();
    });
  });
});

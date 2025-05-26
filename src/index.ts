/**
 * Copyright 2023 Google LLC
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

import {
  SmartCardConnection,
  SmartCardContext,
  SmartCardReaderStateIn,
  SmartCardReaderStateOut,
} from './smart-card'

import * as apdu from './apdu'
import * as ber from './ber'
import * as piv from './piv'
import { assert, toHexString } from './util'

import * as x509 from "@peculiar/x509";

let refreshReadersButton: HTMLButtonElement;
let trackReadersButton: HTMLButtonElement;
let readersListElement: HTMLDivElement;
let scardContext: SmartCardContext | undefined;
// Context used for tracking changes to readers.
let scardTrackingContext: SmartCardContext | undefined = undefined;

interface ReaderUiElements {
  readerDiv: HTMLDivElement;
  connectButton: HTMLButtonElement;
  disconnectButton: HTMLButtonElement;
  readCertButton: HTMLButtonElement;
  certDiv: HTMLDivElement;
}

let readerTrackingAbortion: AbortController | undefined = undefined;

let readerNameToElements: Map<string, ReaderUiElements> = new Map();
let readerConnections: Map<string, SmartCardConnection> = new Map();

const MAX_DATA_LENGTH = 70000;

// PC/SC specific constant for plug and play notifications.
const PNP_NOTIFICATION = String.raw`\\?PnP?\Notification`;
const START_TRACKING_STRING = "Start tracking readers";
const STOP_TRACKING_STRING = "Stop tracking readers";

async function addNewReaders(readerStatesIn: Array<SmartCardReaderStateIn>) {
  assert(scardTrackingContext !== undefined, "addNewReaders: No scardTrackingContext");

  var newReaderStatesIn: Array<SmartCardReaderStateIn> = [];
  const readers = await scardTrackingContext.listReaders();
  readers.forEach((readerName) => {
    if (!readerStatesIn.some((stateIn) => stateIn.readerName === readerName)) {
      newReaderStatesIn.push({
        readerName: readerName,
        currentState: { unaware: true },
      });
    }
  });

  if (newReaderStatesIn.length === 0) {
    return;
  }

  const newReadersStateOut =
    await scardTrackingContext.getStatusChange(newReaderStatesIn);
  newReadersStateOut.forEach((newReaderStateOut) => {
    const eventState = newReaderStateOut.eventState;
    if (eventState.ignore === true ||
        eventState.unknown === true ||
        eventState.unavailable === true) {
      return;
    }
    readerStatesIn.push({
      readerName: newReaderStateOut.readerName,
      currentState: {
        empty: eventState.empty ? eventState.empty : false,
        present: eventState.present ? eventState.present : false,
        exclusive: eventState.exclusive ? eventState.exclusive : false,
        inuse: eventState.inuse ? eventState.inuse : false,
        mute: eventState.mute ? eventState.mute : false,
      },
      currentCount: newReaderStateOut.eventCount,
    });
  });
}

async function startStopTrackingReaders() {
  if (trackReadersButton.innerText === START_TRACKING_STRING) {
    return startTrackingReaders();
  } else {
    return stopTrackingReaders();
  }
}

async function stopTrackingReaders() {
  if (readerTrackingAbortion !== undefined) {
    readerTrackingAbortion.abort();
  }
}

function removeStateInWithName(
    readerStatesIn: Array<SmartCardReaderStateIn>,
    readerName: string) {
  const index = readerStatesIn.findIndex(
    (stateIn) => stateIn.readerName === readerName);

  if (index === -1) {
    return;
  }

  readerStatesIn.splice(index, 1);
}

function updateReaderUIState(readerName: string) {
  const elements = readerNameToElements.get(readerName);
  if (!elements) return;

  const isConnected = readerConnections.has(readerName);

  elements.connectButton.disabled = isConnected;
  elements.disconnectButton.disabled = !isConnected;
  elements.readCertButton.disabled = !isConnected;
}

async function cleanupReaderConnectionAndUI(readerName: string, errorMessage?: string) {
  const elements = readerNameToElements.get(readerName);
  if (elements && errorMessage) {
    elements.certDiv.textContent = ""; // Clear previous content
    const p = document.createElement("p");
    p.style.color = "red";
    p.innerText = "Error: " + errorMessage;
    elements.certDiv.appendChild(p);
  }

  const connection = readerConnections.get(readerName);
  if (connection) {
    try {
      await connection.disconnect();
    } catch (e) {
      // If elements are still there, display this secondary error too, or log it.
      if (elements && elements.certDiv && !errorMessage) { // Avoid overwriting primary error
        const p = document.createElement("p");
        p.style.color = "orange";
        p.innerText = `Note: Disconnect also failed: ${e.message || e}`;
        elements.certDiv.appendChild(p);
      }
    }
    readerConnections.delete(readerName);
  }
  updateReaderUIState(readerName);
}

async function handleConnect(readerName: string) {
  if (!scardContext || readerConnections.has(readerName)) {
    return;
  }
  const elements = readerNameToElements.get(readerName);
  if (elements) {
    elements.certDiv.textContent = ""; // Clear previous messages/certs
  }

  try {
    const connectionResult = await scardContext.connect(
      readerName, "shared", { preferredProtocols: ["t1"] });

    if (connectionResult.activeProtocol !== "t1") {
      throw new DOMException("Unexpected active protocol: " +
                             connectionResult.activeProtocol);
    }
    readerConnections.set(readerName, connectionResult.connection);
    if (elements) {
        const p = document.createElement("p");
        p.style.color = "green";
        p.innerText = `Connected with protocol: ${connectionResult.activeProtocol}`;
        elements.certDiv.appendChild(p);
    }
  } catch (e: any) {
    cleanupReaderConnectionAndUI(readerName, `Connection failed: ${e.message || e}`);
  }
  updateReaderUIState(readerName);
}

async function handleDisconnect(readerName: string) {
  const elements = readerNameToElements.get(readerName);
  if (elements) {
    elements.certDiv.textContent = ""; // Clear previous messages/certs
  }
  await cleanupReaderConnectionAndUI(readerName);
  if (elements) {
    const p = document.createElement("p");
    p.innerText = "Disconnected.";
    elements.certDiv.appendChild(p);
  }
}

function addDivForReader(readerName: string) {
  const readerDiv = document.createElement("div");

  const p = document.createElement("p");
  const span = document.createElement("span");
  span.innerText = readerName;
  const certCardAuthDiv = document.createElement("div");

  const connectButton = document.createElement("button");
  connectButton.innerText = "Connect";
  connectButton.addEventListener('click', () => handleConnect(readerName));

  const disconnectButton = document.createElement("button");
  disconnectButton.innerText = "Disconnect";
  disconnectButton.addEventListener('click', () => handleDisconnect(readerName));

  const readCertificatesButton = document.createElement("button");
  readCertificatesButton.innerText = "Read Certificate for Card Authentication";
  readCertificatesButton.addEventListener('click', () => handleReadCertificateCommand(readerName));

  p.appendChild(span);
  p.appendChild(connectButton);
  p.appendChild(disconnectButton);
  p.appendChild(readCertificatesButton);
  readerDiv.appendChild(p);
  readerDiv.appendChild(certCardAuthDiv);
  readerDiv.appendChild(document.createElement("hr"));

  readersListElement.appendChild(readerDiv);
  readerNameToElements.set(readerName, {
    readerDiv: readerDiv,
    connectButton: connectButton,
    disconnectButton: disconnectButton,
    readCertButton: readCertificatesButton,
    certDiv: certCardAuthDiv,
  });
  updateReaderUIState(readerName); // Set initial button states
}

function updateReadersHTML(readerStatesIn: Array<SmartCardReaderStateIn>) {
  const currentSystemReaderNames = new Set(
    readerStatesIn
      .map(state => state.readerName)
      .filter(name => name !== PNP_NOTIFICATION)
  );

  // Remove HTML & cleanup connections of readers that have been removed from the system
  for (const readerName of Array.from(readerNameToElements.keys())) {
    if (!currentSystemReaderNames.has(readerName)) {
      const elements = readerNameToElements.get(readerName)!;
      if (elements.readerDiv.parentNode) {
        readersListElement.removeChild(elements.readerDiv);
      }
      cleanupReaderConnectionAndUI(readerName, "Reader removed from system.");
      readerNameToElements.delete(readerName);
    }
  }

  // Add HTML for new readers
  readerStatesIn.forEach((stateIn) => {
    if (stateIn.readerName === PNP_NOTIFICATION) return;
    if (readerNameToElements.has(stateIn.readerName)) return; // Already have HTML
    addDivForReader(stateIn.readerName);
  });

  // Handle the "No readers" message
  if (readerNameToElements.size === 0 && !readerStatesIn.some(s => s.readerName !== PNP_NOTIFICATION)) {
    readersListElement.innerText = "No smart card readers available.";
  } else if (readersListElement.innerText !== "" && readerNameToElements.size > 0) {
    readersListElement.innerText = ""; // Clear message if readers are now present
    readerNameToElements.forEach(elements => { // Ensure divs are parented
        if (!elements.readerDiv.parentNode) {
            readersListElement.appendChild(elements.readerDiv);
        }
     });
  }
}

function updateReaderStatesIn(
    readerStatesIn: Array<SmartCardReaderStateIn>,
    readerStatesOut: Array<SmartCardReaderStateOut>) {

  readerStatesOut.forEach((stateOut) => {
    if (stateOut.eventState.unknown === true ||
        stateOut.eventState.unavailable === true) {
      removeStateInWithName(readerStatesIn, stateOut.readerName);
      return;
    }
    const eventState = stateOut.eventState;

    const stateIn = readerStatesIn.find(
      (stateIn) => stateOut.readerName === stateIn.readerName);
    assert(stateIn !== undefined, "updateReaderStatesIn: stateIn !== undefined");

    stateIn.currentState = {
      empty: eventState.empty ? eventState.empty : false,
      present: eventState.present ? eventState.present : false,
      exclusive: eventState.exclusive ? eventState.exclusive : false,
      inuse: eventState.inuse ? eventState.inuse : false,
      mute: eventState.mute ? eventState.mute : false,
    };

    stateIn.currentCount = stateOut.eventCount;
  });
}

async function startTrackingReaders() {
  try {
    if (scardTrackingContext === undefined) {
      scardTrackingContext = await navigator.smartCard.establishContext();
    }

    var readerStatesIn: Array<SmartCardReaderStateIn> = [];

    // PC/SC hack to be notified about new readers being added to the system.
    // Won't work on MacOS.
    readerStatesIn.push({
      readerName: PNP_NOTIFICATION,
      currentState: {}
    });

    trackReadersButton.innerText = STOP_TRACKING_STRING;
    refreshReadersButton.disabled = true;

    while (true) {
      await addNewReaders(readerStatesIn);

      updateReadersHTML(readerStatesIn);

      assert(readerTrackingAbortion === undefined,
             "assertion failed: readerTrackingAbortion === undefined");
      readerTrackingAbortion = new AbortController();

      const readerStatesOut =
        await scardTrackingContext.getStatusChange(
          readerStatesIn,
          {signal: readerTrackingAbortion!.signal});

      readerTrackingAbortion = undefined;

      updateReaderStatesIn(readerStatesIn, readerStatesOut);
    }

  } catch (e) {
    // The AbortError DOMException is the expected result of a user's action
    // (clicking on "stop tracking". So we don't report this particuar error.
    if (!(e instanceof DOMException) || e.name !== "AbortError") {
      readersListElement.innerText = "Failed start tracking: " + e.message;
    }
  }

  trackReadersButton.innerText = START_TRACKING_STRING;
  readerTrackingAbortion = undefined;
  refreshReadersButton.disabled = false;
}

async function refreshReadersList() {
  if (!scardContext) return;

  let fetchedReaderNames: string[];
  try {
    fetchedReaderNames = await scardContext.listReaders();
  } catch (e: any) {
    // Clear existing reader display before showing error
    readersListElement.textContent = ""; // This removes all child nodes
    // Cleanup connections for all previously known readers
    readerNameToElements.forEach(async (elements, name) => {
        await cleanupReaderConnectionAndUI(name);
    });
    readerNameToElements.clear();
    readersListElement.innerText = "Failed to list readers: " + e.message;
    return;
  }

  // If "No smart card readers available." was the text, clear it to allow adding children.
  if (readersListElement.innerText !== "" && fetchedReaderNames.length > 0) {
      readersListElement.innerText = "";
  }

  const knownReaderNames = new Set(readerNameToElements.keys());
  const currentReaderNamesSet = new Set(fetchedReaderNames);

  // Remove readers that are gone
  for (const name of Array.from(knownReaderNames)) { // Iterate over a copy
    if (!currentReaderNamesSet.has(name)) {
      const elements = readerNameToElements.get(name);
      if (elements && elements.readerDiv.parentNode) {
        readersListElement.removeChild(elements.readerDiv);
      }
      await cleanupReaderConnectionAndUI(name, "Reader no longer listed.");
      readerNameToElements.delete(name);
    }
  }

  // Add new readers / ensure existing ones are in DOM
  for (const name of fetchedReaderNames) {
    if (!readerNameToElements.has(name)) {
      addDivForReader(name);
    } else {
        // Ensure it's in the DOM if it was somehow removed (e.g. by innerText)
        const elements = readerNameToElements.get(name)!;
        if (!elements.readerDiv.parentNode) {
            readersListElement.appendChild(elements.readerDiv);
        }
    }
  }

  if (readerNameToElements.size === 0 && fetchedReaderNames.length === 0) {
    readersListElement.innerText = "No smart card readers available.";
  }
}

// Selects the PIV application on the card.
async function selectPIVApplication(scardConnection: SmartCardConnection) {
  const selectPIVApp = {
    // interindustry, no command chain, no secure messaging, logical channel 0
    cla: 0,
    ins: apdu.Instruction.Select,
    p1: apdu.SelectP1.SelectDFByName,
    p2: apdu.SelectP2.FirstOrOnlyOccurrence,
    data: (new Uint8Array(piv.AID)).buffer
  };

  let response:apdu.Response =
    apdu.deserializeResponse(
      await scardConnection.transmit(apdu.serializeCommand(selectPIVApp)));

  if (response.sw !== apdu.SW.Success) {
    throw new Error("Failed to select PIV application: SW=0x"
                + response.sw.toString(16));
  }
}

// Fetches a PIV data object from the card.
async function fetchObject(scardConnection: SmartCardConnection,
                           objectTag: number): Promise<ArrayBuffer> {
  // NIST.SP.800-73-4, part 1
  // 3.1.2 GET DATA Card Command

  let objectTagByteSize:number = ber.numberByteSize(objectTag);

  assert(objectTagByteSize > 0 && objectTagByteSize <= 3,
         `Invalid PIV objectTag byte size: ${objectTagByteSize}`);

  const tagList = new Uint8Array(objectTagByteSize + 2);
  let i:number = 0;

  tagList[i++] = apdu.TagList;
  tagList[i++] = objectTagByteSize;
  ber.serializeNumber(tagList, i, objectTag);

  let command: apdu.CommandP = {
    // CLA: interindustry, no command chain, no secure messaging, logical channel 0
    cla: 0,
    ins: apdu.Instruction.GetData,
    p: apdu.GetDataP.CurrentDF,
    data: tagList.buffer
  };

  const bytes = new Uint8Array(MAX_DATA_LENGTH);
  let dataLength = 0;

  // Get all data bytes.
  // Can be a single GET DATA command if the data is small enough.
  // Otherwise we will have to issue subsequent GET REPONSE commands
  // until the entire data has been fetched.
  while (true) {
    let response:apdu.Response =
      apdu.deserializeResponse(
        await scardConnection.transmit(apdu.serializeCommand(command)));

    if (response.sw !== apdu.SW.Success
        && response.sw1 !== apdu.SW1.BytesStillAvailable) {
      throw new Error("Failed to fetch PIV object: SW=0x"
                  + response.sw.toString(16));
    }

    if (response.data === undefined) {
      throw new Error("GET DATA response has no data");
    }

    if (dataLength + response.data.byteLength > MAX_DATA_LENGTH) {
      throw new Error(`GET DATA is larger than ${MAX_DATA_LENGTH} bytes`);
    }

    const responseBytes = new Uint8Array(response.data);

    bytes.set(responseBytes, dataLength);
    dataLength += responseBytes.byteLength;

    if (response.sw === apdu.SW.Success) {
      break;
    }

    // There are more bytes to be read.
    command = {
      // CLA: interindustry, no command chain, no secure messaging, logical channel 0
      cla: 0,
      ins: apdu.Instruction.GetResponse,
      p: apdu.GetResponseP.Unused,
      ne: response.sw2
    };
  }

  // Parse the data

  if (dataLength < 2) {
    throw new Error("GET DATA response is too short");
  }

  i = 0;

  if (bytes[i++] !== apdu.DiscretionaryData) {
    throw new Error("Invalid GET DATA response from PIV app: not descretionary data");
  }

  let berLength = ber.readLength(bytes, i);
  i = berLength.valueOffset;

  if (berLength.valueOffset + berLength.length !== dataLength) {
    throw new Error("Invalid GET DATA response from PIV app: bad BER encoding");
  }

  return bytes.slice(berLength.valueOffset,
                     berLength.valueOffset + berLength.length).buffer;
}

// Reads the X.509 Certificate for Card Authentication from the PIV application.
async function _internalReadCertificateData(scardConnection: SmartCardConnection)
  : Promise<ArrayBuffer> {
  await selectPIVApplication(scardConnection);

  const certObject = await fetchObject(
    scardConnection, piv.ObjectTag.CertificateForCardAuthentication);

  if (certObject.byteLength === 0) {
    throw new Error(
      "Card does not have a X.509 Certificate for Card Authentication.");
  }

  return ber.getValue(certObject, piv.Tag.Certificate);
}

function addValueOnlyRow(table: HTMLTableElement, value: string) {
    let tr = document.createElement("tr");
    table.appendChild(tr);
    let tdValue = document.createElement("td");
    tr.appendChild(tdValue);

    tdValue.colSpan = 2;
    tdValue.innerText = value;
}

function addRow(table: HTMLTableElement, field: string, value: string) {
    let tr = document.createElement("tr");
    table.appendChild(tr);
    let tdField = document.createElement("td");
    tr.appendChild(tdField);
    let tdValue = document.createElement("td");
    tr.appendChild(tdValue);

    tdField.innerText = field;
    tdValue.innerText = value;
}

function displayCertificate(cert: x509.X509Certificate,
                            title: string,
                            div: HTMLDivElement) {
    const table = document.createElement("table");

    {
      let tr = document.createElement("tr");
      table.appendChild(tr);
      let th = document.createElement("th");
      tr.appendChild(th);

      th.colSpan = 2;
      th.innerText = title;
    }

    const signatureStr =
      toHexString(new Uint8Array(cert.signature), 20);

    addRow(table, "Serial Number:", cert.serialNumber);
    addRow(table, "Subject:", cert.subject);
    addRow(table, "Issuer:", cert.issuer);
    addRow(table, "Not before:", cert.notBefore.toDateString());
    addRow(table, "Not after:", cert.notAfter.toDateString());
    addRow(table, "Signature algorithm:", cert.signatureAlgorithm.name);
    addRow(table, "Signature:", signatureStr);
    addRow(table, "Public key algorithm:", cert.publicKey.algorithm.name);
    addValueOnlyRow(table, cert.publicKey.toString());

    div.appendChild(table);
}

async function handleReadCertificateCommand(readerName: string) {
  const connection = readerConnections.get(readerName);
  const elements = readerNameToElements.get(readerName);

  if (!connection || !elements) {
    console.error("Attempted to read certificate without a connection or elements for", readerName);
    // This state should ideally be prevented by button disablement.
    // If it occurs, ensure UI is consistent.
    if (elements) updateReaderUIState(readerName);
    return;
  }

  elements.certDiv.textContent = ""; // Clear previous content

  try {
    // Using an object to hold the result for better type inference after async callback.
    const resultHolder = { value: undefined as ArrayBuffer | undefined };

    await connection.startTransaction(
      async () => {
        try {
          resultHolder.value = await _internalReadCertificateData(connection);
          return "reset"; // Reset card after successful read
        } catch (transactionError) {
          // This error occurs *inside* the transaction; re-throw to be caught by the outer catch.
          throw transactionError;
        }
      });

    // resultHolder.value is ArrayBuffer | undefined after transaction.
    // Use instanceof for a strong type guard.
    if (resultHolder.value instanceof ArrayBuffer) {
      if (resultHolder.value.byteLength > 0) {
        displayCertificate(new x509.X509Certificate(resultHolder.value),
                           "X.509 Certificate for Card Authentication",
                           elements.certDiv);
      } else {
        // resultHolder.value is an ArrayBuffer, but it's empty.
        // This means _internalReadCertificateData found the certificate object tag,
        // but the actual certificate data within it was empty.
        if (!elements.certDiv.textContent) { // Avoid overwriting other errors.
          const p = document.createElement("p");
          p.innerText = "Certificate is present but empty.";
          elements.certDiv.appendChild(p);
        }
      }
    }
    // If resultHolder.value was not an ArrayBuffer (e.g. undefined), it implies an issue
    // with the transaction or _internalReadCertificateData not adhering to its Promise<ArrayBuffer> contract,
    // or the transaction completed without error but without setting the value.
    // Such a state should ideally be caught by type errors or indicate a deeper problem.
    // The primary error handling is via the catch block.
  } catch (e: any) {
    // Catches errors from startTransaction itself, or re-thrown from transaction callback.
    // Per instructions: "When an error happens during ... reading the certificate,
    // assume the connection is dead and drop the object."
    await cleanupReaderConnectionAndUI(readerName, `Failed to read certificate: ${e.message || e}`);
  }
}

function showFatalError(message: string) {
  readersListElement.innerText = message;
  refreshReadersButton.disabled = true;
  trackReadersButton.disabled = true;
}

document.addEventListener('DOMContentLoaded', async () => {
  readersListElement = document.getElementById('readers-list') as HTMLDivElement;

  refreshReadersButton = document.getElementById('refresh-readers') as HTMLButtonElement;
  refreshReadersButton.addEventListener('click', refreshReadersList);

  trackReadersButton = document.getElementById("track-readers") as HTMLButtonElement;
  trackReadersButton.addEventListener('click', startStopTrackingReaders);

  if (navigator.smartCard === undefined) {
    showFatalError("Smart Card API is not available!");
    return;
  }

  try {
    scardContext = await navigator.smartCard.establishContext();
  } catch (e) {
    showFatalError("Failed to establish context: " + e.message);
    scardContext = undefined;
  }
});

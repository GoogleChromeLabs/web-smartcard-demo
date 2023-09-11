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
  SmartCardContext,
  SmartCardConnection,
  SmartCardDisposition
} from './smart-card'

let refreshReadersButton: HTMLButtonElement;
let readersListElement: HTMLDivElement;
let scardContext: SmartCardContext | undefined;

// PIV Card Application AID (Application Identifier)
// Note that this is just the NIST RID (Registered Application Provider
// IDentifier)
const pivAID = [0xa0, 0x00, 0x00, 0x03, 0x08];

function assert(condition: unknown, msg?: string): asserts condition {
  if (condition === false) throw new Error(msg);
}

// ISO/IEC 7816-4:2005 APDU Instruction byte
enum Instruction {
  Select = 0xA4,
  Verify = 0x20,
}

// ISO/IEC 7816-4:2005 Command APDU (Application Protocol Data Unit)
interface Command {
  cla: number, // Class byte
  ins: Instruction,
  p1: number, // Parameter byte 1
  p2: number, // Parameter byte 2
  data?: ArrayBuffer, // Command data
  ne?: number // Maximum number of bytes expected in the response data field
}

// ISO/IEC 7816-4:2005 Response APDU
interface Response {
  data?: ArrayBuffer,
  sw1: number, // Status byte 1
  sw2: number // Status byte 2
}

async function refreshReadersList() {
  if (!scardContext) {
    return;
  }

  var readers = undefined;
  try {
    readers = await scardContext.listReaders();
  } catch (e) {
    readersListElement.innerText = "Failed to list readers: " + e.message;
    return;
  }

  // Clear the list
  readersListElement.textContent = "";

  if (readers.length === 0) {
    readersListElement.innerText = "No smart card readers available.";
    return;
  }

  var needsDivider = false;
  readers.forEach((readerName) => {
    if (needsDivider) {
      readersListElement.appendChild(document.createElement("hr"));
    }
    const div = document.createElement("div");
    readersListElement.appendChild(div);

    const p = document.createElement("p");

    const span = document.createElement("span");
    span.innerText = readerName;

    const readCertificatesButton = document.createElement("button");
    readCertificatesButton.innerText = "Read certificates";
    readCertificatesButton.addEventListener('click',
        ()=>{ readAndDisplayCertificates(readerName, div); });

    p.appendChild(span);
    p.appendChild(readCertificatesButton);
    div.appendChild(p);

    needsDivider = true;
  });
}

function serializeCommand(apdu: Command) : ArrayBuffer {
  const headerSize:number = 4; // cla + ins + p1 + p2

  // 1) Find how many bytes we need

  let apduSize:number = headerSize;

  if (apdu.data !== undefined) {
    // TODO: calculate how many bytes are needed to hold Nc
    apduSize += 1; // Lc field. Assuming the data size fits in one byte.
    apduSize += apdu.data.byteLength; // Nc field.
  }

  if (apdu.ne !== undefined) {
    if (apdu.ne === 0) {
      throw Error("Command Ne cannot be 0");
    }
    // TODO: calculate how many bytes are needed to hold Ne
    apduSize += 1; // Le field. Assuming the Ne size fits in one byte.
  }

  // 2) Write the Command

  const buffer = new ArrayBuffer(apduSize);
  let i:number = 0;
  const bytes = new Uint8Array(buffer);
  bytes[i++] = apdu.cla;
  bytes[i++] = apdu.ins;
  bytes[i++] = apdu.p1;
  bytes[i++] = apdu.p2;
  if (apdu.data !== undefined) {
    bytes.set(new Uint8Array(apdu.data), i);
    i += apdu.data.byteLength;
  }
  if (apdu.ne !== undefined) {
    // TODO: consider an Ne which takes more than one byte
    bytes[i++] = apdu.ne;
  }
  assert(i === apduSize);

  return buffer;
}

function deserializeResponse(buffer: ArrayBuffer) : Response {
  const statusBytesLength = 2;
  if (buffer.byteLength < statusBytesLength) {
    throw Error("Response APDU is too short");
  }

  if (buffer.byteLength === statusBytesLength) {
    const swBytes = new Uint8Array(buffer);
    return {
      sw1: swBytes[0],
      sw2: swBytes[1]
    };
  }

  const swBytes = new Uint8Array(buffer,
                                 buffer.byteLength - statusBytesLength,
                                 statusBytesLength);

  return {
    data: (new Uint8Array(buffer, 0, buffer.byteLength - statusBytesLength)).buffer,
    sw1: swBytes[0],
    sw2: swBytes[1]
  };
}

/*
async function verify(scardConnection: SmartCardConnection) {
  // Command to check whether verification is necessary
  let checkVerificationNeeded = {
    // interindustry, no command chain, no secure messaging, logical channel 0
    cla: 0,
    ins: Instruction.Verify,
    p1: 0x00, // unused, must be zero
    p2: 0x80 // Specific reference data
  }

  return scardConnection.transmit(serializeCommand(checkVerificationNeeded));
}
*/

async function selectPIVApplication(scardConnection: SmartCardConnection) {
  const selectPIVApp = {
    // interindustry, no command chain, no secure messaging, logical channel 0
    cla: 0,
    ins: Instruction.Select,
    p1: 0x04, // Select by DF name
    p2: 0x00, // First or only occurrence
    data: (new Uint8Array(pivAID)).buffer
  };

  let response:Response =
    deserializeResponse(
      await scardConnection.transmit(serializeCommand(selectPIVApp)));
}

async function readCertificates(scardConnection: SmartCardConnection)
  : Promise<SmartCardDisposition> {
  await selectPIVApplication(scardConnection);
  return "reset";
}

async function readAndDisplayCertificates(readerName: string, div: HTMLDivElement) {
  if (scardContext === undefined) {
    return;
  }

  try {
    const connectionResult = await scardContext.connect(
      readerName, "shared", {preferredProtocols: ["t1"]});

    if (connectionResult.activeProtocol !== "t1") {
      throw new DOMException("Unexpected active protocol: " +
                             connectionResult.activeProtocol);
    }

    await connectionResult.connection.startTransaction(
      ()=>{ return readCertificates(connectionResult.connection); });

    connectionResult.connection.disconnect();

    const p = document.createElement("p");
    p.innerText = "So far so good";
    div.appendChild(p);

  } catch(e) {
    const p = document.createElement("p");
    p.innerText = "Failed to read certificates: " + e;
    div.appendChild(p);
  }
}

document.addEventListener('DOMContentLoaded', async () => {

  readersListElement = document.getElementById('readers-list') as HTMLDivElement;

  refreshReadersButton = document.getElementById('refresh-readers') as HTMLButtonElement;
  refreshReadersButton.addEventListener('click', refreshReadersList);

  try {
    scardContext = await navigator.smartCard.establishContext();
  } catch (e) {
    readersListElement.innerText = "Failed to establish context: " + e.message;
    scardContext = undefined;
    refreshReadersButton.disabled = true;
  }
});

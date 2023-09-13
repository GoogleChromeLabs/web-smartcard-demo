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

import * as apdu from './apdu'

import {
  assert,
  numberByteSize,
  readBERLength,
  serializeNumber
} from './util'

let refreshReadersButton: HTMLButtonElement;
let readersListElement: HTMLDivElement;
let scardContext: SmartCardContext | undefined;

// PIV Card Application AID (Application Identifier)
// Note that this is just the NIST RID (Registered Application Provider
// IDentifier)
const pivAID = [0xa0, 0x00, 0x00, 0x03, 0x08];

// NIST.SP.800-73-4, part 1
// Table 4b. PIV Card Application Key References
enum PIVKeyID {
  CardAuthentication = 0x9E,
}

// NIST.SP.800-73-4, part 1
// Table 3. Object Identifiers of the PIV Data Objects for Interoperable Use
enum PIVObjectTag {
  // X.509 Certificate for Card Authentication
  CertificateForCardAuthentication = 0x5FC101,
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

async function selectPIVApplication(scardConnection: SmartCardConnection) {
  const selectPIVApp = {
    // interindustry, no command chain, no secure messaging, logical channel 0
    cla: 0,
    ins: apdu.Instruction.Select,
    p1: apdu.SelectP1.SelectDFByName,
    p2: apdu.SelectP2.FirstOrOnlyOccurrence,
    data: (new Uint8Array(pivAID)).buffer
  };

  let response:apdu.Response =
    apdu.deserializeResponse(
      await scardConnection.transmit(apdu.serializeCommand(selectPIVApp)));

  if (response.sw !== apdu.StatusWord.Success) {
    throw new Error("Failed to select PIV application: SW=0x"
                + response.sw.toString(16));
  }
}

async function fetchObject(scardConnection: SmartCardConnection,
                           objectTag: number): Promise<ArrayBuffer> {
  // NIST.SP.800-73-4, part 1
  // 3.1.2 GET DATA Card Command

  let objectTagByteSize:number = numberByteSize(objectTag);

  assert(objectTagByteSize > 0 && objectTagByteSize <= 3,
         `Invalid PIV objectTag byte size: ${objectTagByteSize}`);

  const tagList = new Uint8Array(objectTagByteSize + 2);
  let i:number = 0;

  tagList[i++] = apdu.TagList;
  tagList[i++] = objectTagByteSize;
  serializeNumber(tagList, i, objectTag);

  const getData = {
    // CLA: interindustry, no command chain, no secure messaging, logical channel 0
    cla: 0,
    ins: apdu.Instruction.GetData,
    p: apdu.GetDataP.CurrentDF,
    data: tagList.buffer
  };

  let response:apdu.Response =
    apdu.deserializeResponse(
      await scardConnection.transmit(apdu.serializeCommand(getData)));

  if (response.sw !== apdu.StatusWord.Success) {
    throw new Error("Failed to fetch PIV object: SW=0x"
                + response.sw.toString(16));
  }

  if (response.data === undefined) {
    throw new Error("GET DATA response has no data");
  }

  const responseBytes = new Uint8Array(response.data);

  if (responseBytes.byteLength < 2) {
    throw new Error("GET DATA response is too short");
  }

  // Start reading the response

  i = 0;

  if (responseBytes[i++] !== apdu.DiscretionaryData) {
    throw new Error("Invalid GET DATA response from PIV app");
  }

  let berLength = readBERLength(responseBytes, i);
  i = berLength.valueOffset;

  return responseBytes.slice(berLength.valueOffset,
                             berLength.valueOffset + berLength.length).buffer;
}

async function readCertificate(scardConnection: SmartCardConnection)
  : Promise<ArrayBuffer> {
  await selectPIVApplication(scardConnection);

  return fetchObject(scardConnection,
                     PIVObjectTag.CertificateForCardAuthentication);
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

    let certData: ArrayBuffer = new ArrayBuffer(0);

    await connectionResult.connection.startTransaction(
      async function () {
        certData = await readCertificate(connectionResult.connection);
        return "reset";
      });

    connectionResult.connection.disconnect();


    // TODO: parse and display certData

    const p = document.createElement("p");
    p.innerText = `Certificate has ${certData.byteLength} bytes!`;
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

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

let refreshReadersButton: HTMLButtonElement;
let readersListElement: HTMLDivElement;
let scardContext: SmartCardContext | undefined;

// PIV Card Application AID (Application Identifier)
// Note that this is just the NIST RID (Registered Application Provider
// IDentifier)
const pivAID = [0xa0, 0x00, 0x00, 0x03, 0x08];


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

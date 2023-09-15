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
} from './smart-card'

import * as apdu from './apdu'
import * as ber from './ber'
import * as piv from './piv'
import { assert, toHexString } from './util'

import * as x509 from "@peculiar/x509";

let refreshReadersButton: HTMLButtonElement;
let readersListElement: HTMLDivElement;
let scardContext: SmartCardContext | undefined;

const maxDataLength = 70000;

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

    const certCardAuthDiv = document.createElement("div");

    const readCertificatesButton = document.createElement("button");
    readCertificatesButton.innerText = "Read Certificate for Card Authentication";
    readCertificatesButton.addEventListener('click',
        ()=>{ readAndDisplayCertificates(readerName, certCardAuthDiv); });

    p.appendChild(span);
    p.appendChild(readCertificatesButton);
    div.appendChild(p);
    div.appendChild(certCardAuthDiv);

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

  const bytes = new Uint8Array(maxDataLength);
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

    if (dataLength + response.data.byteLength > maxDataLength) {
      throw new Error(`GET DATA is larger than ${maxDataLength} bytes`);
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

async function readCertificate(scardConnection: SmartCardConnection)
  : Promise<ArrayBuffer> {
  await selectPIVApplication(scardConnection);

  const certObject = await fetchObject(
    scardConnection, piv.ObjectTag.CertificateForCardAuthentication);

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

async function readAndDisplayCertificates(readerName: string, div: HTMLDivElement) {
  if (scardContext === undefined) {
    return;
  }

  // Clear any preexisting content.
  div.textContent = "";

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

    assert(certData.byteLength > 0, "Certificate data is empty!");

    displayCertificate(new x509.X509Certificate(certData),
                       "X.509 Certificate for Card Authentication",
                       div);
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

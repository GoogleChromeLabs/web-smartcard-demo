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

import {SmartCardContext} from './smart-card'

let refreshReadersButton: HTMLButtonElement;
let readersListElement: HTMLDivElement;
let scardContext: SmartCardContext | undefined;

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
    const p = document.createElement("p");

    const span = document.createElement("span");
    span.innerText = readerName;

    const readCertificatesButton = document.createElement("button");
    readCertificatesButton.innerText = "Read certificates";

    p.appendChild(span);
    p.appendChild(readCertificatesButton);
    readersListElement.appendChild(p);

    needsDivider = true;
  });
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

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

// Definitions from
// NIST.SP.800-73-4: Interfaces for Personal Identity Verification

// Card Application AID (Application Identifier)
// Note that this is just the NIST RID (Registered Application Provider
// IDentifier)
export const AID = [0xa0, 0x00, 0x00, 0x03, 0x08];

// Table 4b. PIV Card Application Key References
export enum KeyID {
  CardAuthentication = 0x9E,
}

// Table 3. Object Identifiers of the PIV Data Objects for Interoperable Use
export enum ObjectTag {
  // X.509 Certificate for Card Authentication
  CertificateForCardAuthentication = 0x5FC101,
}

// Tags inside an object
export enum Tag {
  Certificate = 0x70,
  CertInfo = 0x71,
  MSCUID = 0x72,
  ErrorDetectionCode = 0xFE,
}

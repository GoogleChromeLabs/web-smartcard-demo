/**
 * Copyright 2023 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// https://wicg.github.io/web-smart-card/#smartcardcontext-interface
export interface SmartCardContext {
  listReaders(): Promise<Array<string>>;
  connect(readerName: string,
          accessMode: SmartCardAccessMode,
          options?: SmartCardConnectOptions): Promise<SmartCardConnectResult>;
}

// https://wicg.github.io/web-smart-card/#dom-smartcardconnectresult
export interface SmartCardConnectResult {
  connection: SmartCardConnection;
  activeProtocol?: SmartCardProtocol;
}

// https://wicg.github.io/web-smart-card/#dom-smartcarddisposition
export type SmartCardDisposition =
  "leave" | "reset" | "unpower" | "eject";

// https://wicg.github.io/web-smart-card/#dom-smartcardtransactionoptions
export interface SmartCardTransactionOptions {
  signal?: AbortSignal;
}

// https://wicg.github.io/web-smart-card/#dom-smartcardtransmitoptions
export interface SmartCardTransmitOptions {
  protocol?: SmartCardProtocol
}

// https://wicg.github.io/web-smart-card/#smartcardconnection-interface
export interface SmartCardConnection {
  startTransaction(transaction: SmartCardTransactionCallback,
        options?: SmartCardTransactionOptions): Promise<undefined>;
  disconnect( disposition?: SmartCardDisposition): Promise<undefined>;
  transmit(sendBuffer: BufferSource,
           options?: SmartCardTransmitOptions): Promise<ArrayBuffer>;

}
export type SmartCardTransactionCallback =
  () => Promise<SmartCardDisposition | undefined>;

// https://wicg.github.io/web-smart-card/#dom-smartcardprotocol
export type SmartCardProtocol = "raw" | "t0" | "t1";

// https://wicg.github.io/web-smart-card/#dom-smartcardaccessmode
export type SmartCardAccessMode =
  "shared" | "exclusive" | "direct";

// https://wicg.github.io/web-smart-card/#dom-smartcardconnectoptions
export interface SmartCardConnectOptions {
  preferredProtocols: Array<SmartCardProtocol>;
}

// https://wicg.github.io/web-smart-card/#smartcardresourcemanager-interface
export interface SmartCardResourceManager {
  establishContext(): Promise<SmartCardContext>;
}

// https://wicg.github.io/web-smart-card/#extensions-to-the-navigator-interface
declare global {
  interface Navigator {
    smartCard: SmartCardResourceManager;
  }
}

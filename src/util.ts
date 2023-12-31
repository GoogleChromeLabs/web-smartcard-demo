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

export function assert(condition: unknown, msg?: string): asserts condition {
  if (condition === false) throw new Error(msg);
}

export function toHexString(bytes: any,
                            bytesPerLine: number = 0,
                            lineSeparator: string = "\n"): string {
  let currByte = 0;
  return Array.from(bytes, (byte: number) => {
    let hexStr = byte.toString(16).padStart(2, '0');
    if (bytesPerLine > 0 && (currByte % bytesPerLine === 0) && (currByte > 0)) {
      hexStr = lineSeparator + hexStr;
    }
    currByte++;
    return hexStr;
  }).join('');
};

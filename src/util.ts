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

// For debugging
export const toHexString = (bytes: any) => {
  return Array.from(bytes, (byte: number) => {
    return ('0' + (byte & 0xff).toString(16)).slice(-2);
  }).join('');
};

export function numberByteSize(value: number): number {
  let byteSize = 0;
  while (value > 0) {
    byteSize++;
    value = value >> 8;
  }
  return byteSize;
}

// in big-endian
export function serializeNumber(bytes: Uint8Array, bytesOffset:number, n: number) {
  let i:number = bytesOffset;

  let currentDigit:number = numberByteSize(n);

  while (currentDigit > 0) {
    let digitValue = (n >> (8 * (currentDigit - 1))) & 0xFF;
    bytes[i++] = digitValue;
    currentDigit--;
  }
}

export interface BERLength {
  length: number,
  valueOffset: number
}

export function deserializeNumber(bytes: Uint8Array,
                           bytesOffset:number,
                           numberByteSize:number): number {
  assert(bytesOffset >= 0 && bytesOffset < bytes.byteLength,
         "deserializeNumber: invalid bytesOffset");
  assert(numberByteSize > 0 && numberByteSize <= (bytes.byteLength - bytesOffset),
        "deserializeNumber: invalid numberByteSize");

  let currentDigit = numberByteSize;
  let n: number = 0
  while (currentDigit > 0) {
    let i = bytesOffset + (numberByteSize - currentDigit);
    n |= bytes[i] << (8 * (currentDigit - 1))
    currentDigit--;
  }
  return n;
}

export function readBERLength(bytes: Uint8Array, bytesOffset:number): BERLength {
  let i = bytesOffset;
  if (bytes[i] < 128) {
    // Definite, short
    return {
      length: bytes[i],
      valueOffset: bytesOffset + 1
    };
  } else if (bytes[i] === 128) {
    // Indefinite
    // Assuming the two last bytes are End-of-Content (EOC) identifiers.
    return {
      length: bytes.byteLength - (bytesOffset + 1) - 2,
      valueOffset: bytesOffset + 1
    };
  } else {
    // Definite, long
    let numberByteSize = bytes[i++] & 127;
    let n = deserializeNumber(bytes, i, numberByteSize);
    return {
      length: n,
      valueOffset: i + numberByteSize
    };
  }
}

export function getBERValue(buffer: ArrayBuffer, tag: number) : ArrayBuffer {
  let i = 0;
  const bytes = new Uint8Array(buffer);

  while(i < bytes.byteLength) {
    const currentTag = bytes[i++];
    const berLength = readBERLength(bytes, i);

    if (currentTag !== tag) {
      // Skip it.
      i = berLength.valueOffset + berLength.length;
      continue;
    }

    return buffer.slice(berLength.valueOffset,
                        berLength.valueOffset + berLength.length);
  }

  throw Error(`Could not find tag 0x${tag.toString(16)}.`);
}

/**
 * Copyright 2025 Google LLC
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

import { arrayBufferToHexString } from './util';

describe('util', () => {
  describe('arrayBufferToHexString', () => {
    test('should convert an ArrayBuffer to a hex string correctly', () => {
      const buffer = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]).buffer;
      expect(arrayBufferToHexString(buffer)).toBe('de ad be ef');
    });

    test('should handle an empty ArrayBuffer', () => {
      const buffer = new Uint8Array([]).buffer;
      expect(arrayBufferToHexString(buffer)).toBe('');
    });

    test('should handle a single byte ArrayBuffer', () => {
      const buffer = new Uint8Array([0x42]).buffer;
      expect(arrayBufferToHexString(buffer)).toBe('42');
    });

    test('should handle leading zeros in bytes', () => {
        const buffer = new Uint8Array([0x01, 0x02, 0x0F, 0x0A]).buffer;
        expect(arrayBufferToHexString(buffer)).toBe('01 02 0f 0a');
    });
  });
});

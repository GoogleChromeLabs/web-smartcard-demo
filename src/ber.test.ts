/**
 * Copyright 2026 Google LLC
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

import { deserializeNumber, getValue, readLength } from './ber';

describe('ber', () => {
  describe('deserializeNumber', () => {
    test('should decode unsigned 4-byte big-endian integers with MSB set without signed 32-bit overflow', () => {
      expect(deserializeNumber(new Uint8Array([0x80, 0x00, 0x00, 0x00]), 0, 4)).toBe(0x80000000);
      expect(deserializeNumber(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFA]), 0, 4)).toBe(0xFFFFFFFA);
    });
  });

  describe('readLength', () => {
    test('should parse definite short-form length', () => {
      const bytes = new Uint8Array([0x70, 0x03, 0xAA, 0xBB, 0xCC]);
      expect(readLength(bytes, 1)).toEqual({ length: 3, valueOffset: 2 });
    });

    test('should parse definite long-form length', () => {
      const bytes = new Uint8Array([0x70, 0x81, 0x03, 0xAA, 0xBB, 0xCC]);
      expect(readLength(bytes, 1)).toEqual({ length: 3, valueOffset: 3 });
    });

    test('should parse indefinite-form length with EOC', () => {
      const bytes = new Uint8Array([0x70, 0x80, 0xAA, 0xBB, 0x00, 0x00]);
      expect(readLength(bytes, 1)).toEqual({ length: 2, valueOffset: 2 });
    });

    test('should throw when long-form length has MSB set (negative signed int32) and exceeds buffer', () => {
      const bytes = new Uint8Array([0x71, 0x84, 0xFF, 0xFF, 0xFF, 0xFA]);
      expect(() => readLength(bytes, 1)).toThrow(
        'Invalid BER length: value extends past end of buffer'
      );
    });

    test('should throw when indefinite-form buffer is too short for EOC', () => {
      const bytes = new Uint8Array([0x71, 0x80]);
      expect(() => readLength(bytes, 1)).toThrow(
        'Invalid BER length: value extends past end of buffer'
      );
    });

    test('should throw when short-form length extends past end of buffer', () => {
      const bytes = new Uint8Array([0x70, 0x05, 0xAA]);
      expect(() => readLength(bytes, 1)).toThrow(
        'Invalid BER length: value extends past end of buffer'
      );
    });

    test('should throw when 5-byte long-form length exceeds 4 bytes (instead of wrapping shift mod 32)', () => {
      // 0x85 means 5 length bytes follow: 0x0100000000 (4,294,967,296 bytes).
      // With 32-bit shift wrapping (0x01 << 32 === 1), this would be misparsed as length 1.
      const bytes = new Uint8Array([0x70, 0x85, 0x01, 0x00, 0x00, 0x00, 0x00, 0xAA]);
      expect(() => readLength(bytes, 1)).toThrow(
        'deserializeNumber: invalid numberByteSize'
      );
    });
  });

  describe('getValue', () => {
    test('should extract value for matching tag after skipping preceding tags', () => {
      const buffer = new Uint8Array([
        0x71, 0x01, 0x00,
        0x70, 0x03, 0xDE, 0xAD, 0xBE,
      ]).buffer;
      const result = new Uint8Array(getValue(buffer, 0x70));
      expect(Array.from(result)).toEqual([0xDE, 0xAD, 0xBE]);
    });

    test('should throw instead of hanging on crafted 4-byte long-form length with MSB set', () => {
      const buffer = new Uint8Array([0x71, 0x84, 0xFF, 0xFF, 0xFF, 0xFA]).buffer;
      expect(() => getValue(buffer, 0x70)).toThrow(
        'Invalid BER length: value extends past end of buffer'
      );
    });
  });
});

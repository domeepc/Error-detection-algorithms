/** One allocated block on an AddressBar: `start` and `size` are raw 32-bit address values. */
export interface BarSegment {
  key: string;
  label: string;
  start: number;
  size: number;
  prefix: number;
}

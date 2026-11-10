export const add = (a: number, b: number): number => a + b
export default function multiply(a: number, b: number) {
  return a * b
}
export enum Color {
  Red,
  Green,
}
export class Calc {
  constructor(private value: number) {}
  double() {
    return this.value * 2
  }
}

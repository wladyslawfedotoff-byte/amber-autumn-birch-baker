declare module "heic-convert" {
  type Input = { buffer: Uint8Array | ArrayBuffer; format: "JPEG" | "PNG"; quality?: number };
  const convert: (input: Input) => Promise<ArrayBuffer>;
  export default convert;
}

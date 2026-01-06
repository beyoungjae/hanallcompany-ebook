declare module "/pdfjs/pdf.mjs" {
  export const GlobalWorkerOptions: { workerSrc: string };
  export const getDocument: (params: { url: string }) => { promise: Promise<any> };
}



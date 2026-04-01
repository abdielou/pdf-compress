declare module '@jspawn/ghostscript-wasm' {
  interface GsModule {
    callMain(args: string[]): number
    FS: {
      writeFile(path: string, data: Uint8Array | string): void
      readFile(path: string): Uint8Array
      unlink(path: string): void
      stat(path: string): { size: number }
    }
  }

  interface ModuleOptions {
    print?: (text: string) => void
    printErr?: (text: string) => void
    locateFile?: (file: string) => string
  }

  export default function Module(options?: ModuleOptions): Promise<GsModule>
}

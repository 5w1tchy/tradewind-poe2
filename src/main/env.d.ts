// electron-vite resolves `?asset` imports to a runtime file path (the asset is
// copied into the build output and packed into the asar). Used for the splash
// image — see splash.ts.
declare module '*?asset' {
  const path: string
  export default path
}

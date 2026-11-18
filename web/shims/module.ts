// require.resolve is used to find three.js files for the 3D viewer; the browser build serves them.
export const createRequire = () => Object.assign(() => { throw new Error('require is not available in the browser') }, { resolve: (id: string) => `/vendor/${id}` })
export default { createRequire }

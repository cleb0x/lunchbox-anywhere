export class Readable { static fromWeb(): never { throw new Error('Not available in the browser') } }
export async function pipeline(): Promise<never> { throw new Error('Not available in the browser') }
export default { Readable, pipeline }

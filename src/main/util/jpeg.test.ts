import { describe, it, expect } from 'vitest'
import { JpegFrameSplitter } from './jpeg'

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])
const frame = (body: number[]): Buffer => Buffer.concat([SOI, Buffer.from(body), EOI])

describe('JpegFrameSplitter', () => {
  it('liefert einen vollständigen Frame', () => {
    const s = new JpegFrameSplitter()
    const f = frame([1, 2, 3])
    expect(s.push(f)).toEqual([f])
  })

  it('setzt über mehrere Chunks zusammen', () => {
    const s = new JpegFrameSplitter()
    const f = frame([1, 2, 3])
    expect(s.push(f.subarray(0, 3))).toEqual([]) // SOI + 1 Byte, kein EOI
    expect(s.push(f.subarray(3))).toEqual([f])
  })

  it('trennt zwei Frames in einem Chunk', () => {
    const s = new JpegFrameSplitter()
    const a = frame([1])
    const b = frame([2, 3])
    expect(s.push(Buffer.concat([a, b]))).toEqual([a, b])
  })

  it('verwirft führenden Müll vor dem Frame-Start', () => {
    const s = new JpegFrameSplitter()
    const a = frame([9])
    expect(s.push(Buffer.concat([Buffer.from([0x00, 0x11, 0x22]), a]))).toEqual([a])
  })

  it('reset() verwirft den Teilpuffer', () => {
    const s = new JpegFrameSplitter()
    s.push(SOI) // unvollständig
    s.reset()
    const a = frame([5])
    expect(s.push(a)).toEqual([a])
  })
})

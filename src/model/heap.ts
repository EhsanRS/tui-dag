/** Minimal binary min-heap used by the topological sort. Internal. */
export class MinHeap<T> {
  private readonly items: T[] = []

  constructor(private readonly before: (a: T, b: T) => boolean) {}

  get size() {
    return this.items.length
  }

  push(item: T) {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parentIndex = (i - 1) >> 1
      const parent = items[parentIndex]
      if (parent === undefined || !this.before(item, parent)) break
      items[i] = parent
      i = parentIndex
    }
    items[i] = item
  }

  pop(): T | undefined {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (top === undefined || last === undefined || items.length === 0) return top
    let i = 0
    for (;;) {
      const left = 2 * i + 1
      const right = left + 1
      let best = i
      let bestItem = last
      const leftItem = items[left]
      if (leftItem !== undefined && this.before(leftItem, bestItem)) {
        best = left
        bestItem = leftItem
      }
      const rightItem = items[right]
      if (rightItem !== undefined && this.before(rightItem, bestItem)) {
        best = right
        bestItem = rightItem
      }
      if (best === i) break
      items[i] = bestItem
      i = best
    }
    items[i] = last
    return top
  }
}

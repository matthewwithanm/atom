const {CompositeDisposable, Disposable, Emitter} = require('event-kit')
const invariant = require('assert')

module.exports =
/**
 * An ordered set with exactly one of its entries selected. It's possible to have no entry selected,
 * but only while the set is empty.
 *
 * Note that this intentionally does not implement a way to observe the destruction of items (i.e.
 * `onDidDestroyEntry()`). Were it to, the event would not be emitted if if an item was removed
 * first and then destroyed. Any code relying on the event (for example to clean up a resource)
 * would therefore be incorrect. If you care about item destruction, listen for it on the items
 * directly.
 *
 * Items in the lists are referred to as "entries" (as opposed to "items" or "elements") so as to
 * avoid confusion with workspace items ("pane items") and HTMLElements, respectively.
 */
class SelectionOrderedSet {
  // * `options` An {Object} with the following keys:
  //   * `entries`  An {Array} of entries with which to populate the list
  //   * `selectedIndex` A {number} specifying the selected entry
  constructor (options = {}) {
    this.currentTransactionChangedEntries = false
    this.transactionDepth = 0
    this.entries = options.entries || []
    if (options.selectedIndex == null) {
      this.selectedIndex = this.entries.length === 0 ? -1 : 0
    } else {
      if (options.selectedIndex === -1 && this.entries.length !== 0) throw new Error('Initial selection required')
      if (options.selectedIndex >= this.entries.length) throw new Error('Invalid selected entry index')
      this.selectedIndex = options.selectedIndex
    }
    this.emitter = new Emitter()
    this.subscriptions = this.usingEachEntry(entry => {
      if (typeof entry.onDidDestroy === 'function') {
        return entry.onDidDestroy(() => { this.remove(entry) })
      }
      return new Disposable()
    })
  }

  isAlive () { return this.alive }

  isDestroyed () { return !this.isAlive() }

  getSelectedIndex () { return this.selectedIndex }

  getSelectedEntry () { return this.entries[this.selectedIndex] }

  getEntries () { return this.entries.slice() }

  getSize () { return this.entries.length }

  add (entry) { this.addAt(entry, this.getSize()) }

  addAt (entry, index) {
    this.transact(() => {
      invariant(!this.includes(entry))
      invariant(index <= this.getSize())
      this.entries.splice(index, 0, entry)
      if (index <= this.selectedIndex) this.selectedIndex++
      this.didAddEntry(entry, index)
    })
  }

  includes (entry) { return this.entries.includes(entry) }

  indexOf (entry) { return this.entries.indexOf(entry) }

  remove (entry) {
    const index = this.indexOf(entry)
    if (index === -1) return
    this.removeAt(index)
  }

  removeAt (index) {
    this.transact(() => {
      const entry = this.entries[index]
      this.entries.splice(index, 1)
      const size = this.getSize()
      if (size === 0) {
        this.selectedIndex = -1
      } else if (index < this.selectedIndex) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1)
      } else {
        this.selectedIndex = Math.min(this.selectedIndex, size - 1)
      }
      this.didRemoveEntry(entry, index)
    })
  }

  selectNext () {
    const size = this.getSize()
    if (size === 0) return
    this.selectAt((this.selectedIndex + 1) % size)
  }

  selectPrevious () {
    const size = this.getSize()
    if (size === 0) return
    this.selectAt((this.selectedIndex - 1 + size) % size)
  }

  select (entry) {
    const index = this.indexOf(entry)
    if (index === -1) throw new Error('Entry not in set')
    this.selectAt(index)
  }

  selectAt (index) {
    this.transact(() => {
      if (index === this.selectedIndex) return
      if (index < 0 || index >= this.getSize()) throw new Error('Invalid selection index')
      this.selectedIndex = index
    })
  }

  destroy () {
    this.subscriptions.dispose()
    this.destroyEntries()
    this.alive = false
    this.didDestroy()
    this.emitter.dispose()
  }

  destroyEntries () {
    this.transact(() => {
      this.getEntries().forEach(entry => {
        if (!this.includes(entry)) throw new Error('Entry not in set')
        destroyEntry(entry)
        this.remove(entry)
      })
    })
  }

  // Execute a series of operations within a single transaction, deferring "did-change-entries" and
  // "dad-change-selected-entry" events until the transaction is completed. Unfortunately, the
  // "did-add-entry" and "did-remove-entry" events carry the index (which relates to the state at
  // that moment) and therefore must be dispatched immediately upon mutation; otherwise we would
  // defer those as well.
  //
  // The effect is similar to debouncing, however the events are synchronous (always part of the
  // same stack).
  //
  // This allows us to minimize the work subscribers do during batched or cascading changes.
  transact (fn) {
    if (this.emitting) {
      // Mutating the set from within an event handler is bad. This is the same reason that Flux
      // doesn't want you to "dispatch within a dispatch." The best way to illustrate the problem is
      // with an example:
      //
      //     const set = new SelectionOrderedSet({entries: ['a', 'b', 'c']})
      //     const logEvent = id => ({entry, index}) => {
      //       console.log(`listener ${id}: ${entry} removed from index ${index}. size is now ${set.getSize()}.`)
      //     }
      //     set.onDidRemoveEntry(logEvent(1))
      //     set.onDidRemoveEntry(once(_ => { set.remove('b') }))
      //     set.onDidRemoveEntry(logEvent(2))
      //     set.remove('a')
      //
      // The output from the above will be:
      //
      //     > "listener 1: a removed from index 0. size is now 2."
      //     > "listener 1: b removed from index 0. size is now 1."
      //     > "listener 2: b removed from index 0. size is now 1."
      //     > "listener 2: a removed from index 0. size is now 1."
      //
      // This can create headaches and subtle bugs for other objects listening an attempting to
      // synchronize their state.
      console.warn(
        'Attempting to mutate the set from an event handler. This is bad and can result in ' +
          'out-of-order events. In a future version, it might just throw an error. So fix it!'
      )
    }

    const prevSelectedEntry = this.getSelectedEntry()
    this.transactionDepth++
    fn()
    this.transactionDepth--

    if (this.transactionDepth !== 0) return

    if (this.currentTransactionChangedEntries) {
      this.currentTransactionChangedEntries = false
      // Note: it's possible that this is a false positive. For example, if the same item was
      // removed and then added back. We accept this though in order to keep the operation O(1).
      // (Checking if there actually was a change here would be O(n).)
      // TODO: This is currently O(n) anyway because `getEntries()` is, but it doesn't actually have
      // to be.
      this.emit('did-change-entries', this.getEntries())
    }

    const selectedEntry = this.getSelectedEntry()
    if (selectedEntry !== prevSelectedEntry) {
      this.emit('did-change-selected-entry', selectedEntry)
    }
  }

  // All event dispatching should go through this method (instead of `this.emitter.emit()` directly)
  // so that we can detect dispatches within dispatches.
  emit (...args) {
    this.emitting = true
    const disposable = this.emitter.emit(...args)
    this.emitting = false
    return disposable
  }

  // Event subscription methods

  onDidAddEntry (fn) {
    return this.emitter.on('did-add-entry', fn)
  }

  onDidChangeSelectedEntry (fn) {
    return this.emitter.on('did-change-selected-entry', fn)
  }

  onDidChangeEntries (fn) {
    return this.emitter.on('did-change-entries', fn)
  }

  onDidDestroy (fn) {
    return this.emitter.once('did-destroy', fn)
  }

  onDidRemoveEntry (fn) {
    return this.emitter.on('did-remove-entry', fn)
  }

  observeEntries (fn) {
    fn(this.getEntries())
    return this.onDidChangeEntries(fn)
  }

  observeEachEntry (fn) {
    this.getEntries().forEach(entry => { fn(entry) })
    return this.onDidAddEntry(({entry}) => { fn(entry) })
  }

  observeSelectedEntry (fn) {
    fn(this.getSelectedEntry())
    return this.onDidChangeSelectedEntry(fn)
  }

  // Calls a function for each added entry. The function is expected to return a disposable that is
  // disposed of when the entry is removed from the set or when the consumer stops listening.
  usingEachEntry (fn) {
    const disposable = new CompositeDisposable()
    disposable.add(
      this.observeEachEntry(entry => {
        const entryDisposable = new CompositeDisposable(
          fn(entry),
          this.onDidRemoveEntry(({entry: ent}) => {
            if (ent === entry) {
              entryDisposable.dispose()
            }
          }),
          new Disposable(() => { disposable.remove(entryDisposable) })
        )
        disposable.add(entryDisposable)
      }),
      this.onDidDestroy(() => { disposable.dispose() })
    )
    return disposable
  }

  //
  // Event trigger methods. We intentionally do not have a `didChangeEntries()` or
  // `didChangeSelectedEntry()` because those should only be dispatched in one location:
  // `transact()`.
  //

  didAddEntry (entry, index) {
    this.currentTransactionChangedEntries = true
    this.emit('did-add-entry', {entry, index})
  }

  didDestroy () {
    this.emit('did-destroy')
  }

  didRemoveEntry (entry, index) {
    this.currentTransactionChangedEntries = true
    this.emit('did-remove-entry', {entry, index})
  }

  // Serialization

  serialize () {
    return {
      deserializer: 'SelectionOrderedSet',
      entries: this.getEntries().map(entry => entry.serialize()),
      selectedIndex: this.selectedIndex
    }
  }

  static deserialize (state, {deserializers}) {
    const entries = (state.entries || []).map(entry => deserializers.deserialize(entry))
    return new SelectionOrderedSet({entries, selectedIndex: state.selectedIndex})
  }
}

function destroyEntry (entry) {
  if (typeof entry.destroy === 'function') entry.destroy()
}

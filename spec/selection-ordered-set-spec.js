/** @babel */

import {Emitter} from 'event-kit'
import {it, fit, ffit, fffit, beforeEach, afterEach} from './async-spec-helpers'
import SelectionOrderedSet from '../src/selection-ordered-set'

describe('SelectionOrderedSet', () => {
  describe('remove', () => {
    it('selects the next item if you remove the selected item', () => {
      const set = new SelectionOrderedSet({
        entries: ['a', 'b', 'c'],
        selectedIndex: 1
      })
      const spy = jasmine.createSpy()
      set.onDidRemoveEntry(spy)
      set.remove('b')
      expect(set.getSelectedEntry()).toBe('c')
      expect(spy).toHaveBeenCalledWith({entry: 'b', index: 1})
    })

    it('selects the new final item in the set if you remove the previous one', () => {
      const set = new SelectionOrderedSet({
        entries: ['a', 'b', 'c'],
        selectedIndex: 2
      })
      const spy = jasmine.createSpy()
      set.onDidRemoveEntry(spy)
      set.remove('c')
      expect(set.getSelectedEntry()).toBe('b')
      expect(spy).toHaveBeenCalledWith({entry: 'c', index: 2})
    })

    it('maintains the selection if you remove an item', () => {
      const set = new SelectionOrderedSet({
        entries: ['a', 'b', 'c'],
        selectedIndex: 1
      })
      const spy = jasmine.createSpy()
      set.onDidRemoveEntry(spy)
      set.remove('a')
      expect(set.getSelectedEntry()).toBe('b')
      expect(spy).toHaveBeenCalledWith({entry: 'a', index: 0})
    })

    it('removes the selection if you remove the only item', () => {
      const set = new SelectionOrderedSet({entries: ['a'], selectedIndex: 0})
      const spy = jasmine.createSpy()
      set.onDidRemoveEntry(spy)
      set.remove('a')
      expect(set.getSelectedEntry()).toBe(undefined)
      expect(set.getSelectedIndex()).toBe(-1)
      expect(spy).toHaveBeenCalledWith({entry: 'a', index: 0})
    })
  })

  describe('transact', () => {
    it('defers dispatching of did-change-entries and did-change-selected-entry', () => {
      const set = new SelectionOrderedSet({entries: ['a', 'b', 'c']})
      const onDidChangeEntriesSpy = jasmine.createSpy()
      const onDidChangeSelectedEntrySpy = jasmine.createSpy()
      set.onDidChangeEntries(onDidChangeEntriesSpy)
      set.onDidChangeSelectedEntry(onDidChangeSelectedEntrySpy)
      set.transact(() => {
        set.add('d')
        set.remove('a')
        set.select('c')
        expect(onDidChangeEntriesSpy).not.toHaveBeenCalled()
        expect(onDidChangeSelectedEntrySpy).not.toHaveBeenCalled()
      })
      expect(onDidChangeEntriesSpy).toHaveBeenCalledWith(set.getEntries())
      expect(onDidChangeSelectedEntrySpy).toHaveBeenCalledWith('c')
    })

    it('warns when mutating from an event handler', () => {
      const set = new SelectionOrderedSet()
      const spy = spyOn(console, 'warn').andCallThrough()
      let called = false
      set.onDidAddEntry(() => {
        if (called) return
        called = true
        set.add('b')
      })
      set.add('a')
      expect(spy.callCount).toBe(1)
      expect(spy.mostRecentCall.args[0]).toContain(
        'Attempting to mutate the set from an event handler.'
      )
    })
  })

  describe('destroy', () => {
    it('destroys the set', () => {
      const set = new SelectionOrderedSet()
      const spy = jasmine.createSpy()
      set.onDidDestroy(spy)
      set.destroy()
      expect(spy.callCount).toBe(1)
      expect(set.isDestroyed()).toBe(true)
      expect(set.isAlive()).toBe(false)
    })

    it('destroys the entries', () => {
      const a = new Destructable()
      const b = new Destructable()
      const set = new SelectionOrderedSet({entries: [a, b]})
      set.destroy()
      expect(a.destroy.callCount).toBe(1)
      expect(a.destroy.callCount).toBe(1)
    })

    it('removes the entries', () => {
      const set = new SelectionOrderedSet({entries: ['a', 'b']})
      const spy = jasmine.createSpy()
      set.onDidRemoveEntry(spy)
      set.destroy()
      expect(spy.callCount).toBe(2)
      const removed = spy.calls.map(call => call.args[0].entry).sort()
      expect(removed).toEqual(['a', 'b'])
      expect(set.getSize()).toBe(0)
    })

    it('triggers did-change-entries and did-change-selected-entry', () => {
      const set = new SelectionOrderedSet({entries: ['a', 'b']})
      const onDidChangeEntriesSpy = jasmine.createSpy()
      const onDidChangeSelectedEntrySpy = jasmine.createSpy()
      set.onDidChangeEntries(onDidChangeEntriesSpy)
      set.onDidChangeSelectedEntry(onDidChangeSelectedEntrySpy)
      set.destroy()
      expect(onDidChangeEntriesSpy.callCount).toBe(1)
      expect(onDidChangeSelectedEntrySpy.callCount).toBe(1)
      expect(set.getSelectedEntry()).toBeUndefined()
    })
  })

  describe('entry observation', () => {
    it("removes items when they're destroyed", () => {
      const a = new Destructable()
      const set = new SelectionOrderedSet({entries: [a, 'b']})
      const spy = jasmine.createSpy()
      set.onDidRemoveEntry(spy)
      a.destroy()
      expect(spy.callCount).toBe(1)
      expect(spy.mostRecentCall.args[0]).toEqual({entry: a, index: 0})
      expect(set.getEntries()).toEqual(['b'])

      // Let's make sure things we add later work too.
      spy.reset()
      const c = new Destructable()
      set.add(c)
      c.destroy()
      expect(spy.callCount).toBe(1)
      expect(spy.mostRecentCall.args[0]).toEqual({entry: c, index: 1})
      expect(set.getEntries()).toEqual(['b'])
    })
  })
})

class Destructable {
  constructor () {
    this.emitter = new Emitter()
    spyOn(this, 'destroy').andCallThrough()
  }
  onDidDestroy (fn) {
    return this.emitter.on('did-destroy', fn)
  }
  destroy () {
    this.emitter.emit('did-destroy')
  }
}

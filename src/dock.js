const etch = require('etch')
const {CompositeDisposable, Emitter} = require('event-kit')
const PaneContainer = require('./pane-container')
const TextEditor = require('./text-editor')
const Grim = require('grim')

const $ = etch.dom
const MINIMUM_SIZE = 100
const DEFAULT_INITIAL_SIZE = 300
const RESIZE_HANDLE_RESIZABLE_CLASS = 'atom-dock-resize-handle-resizable'
const CURSOR_OVERLAY_VISIBLE_CLASS = 'atom-dock-cursor-overlay-visible'

// Extended: A container at the edges of the editor window capable of holding items.
// You should not create a Dock directly. Instead, access one of the three docks of the workspace
// via {Workspace::getLeftDock}, {Workspace::getRightDock}, and {Workspace::getBottomDock}
// or add an item to a dock via {Workspace::open}.
module.exports = class Dock {
  constructor (params) {
    this.handleResizeHandleDragStart = this.handleResizeHandleDragStart.bind(this)
    this.handleResizeToFit = this.handleResizeToFit.bind(this)
    this.handleMouseMove = this.handleMouseMove.bind(this)
    this.handleMouseUp = this.handleMouseUp.bind(this)
    this.toggle = this.toggle.bind(this)

    this.location = params.location
    this.widthOrHeight = getWidthOrHeight(this.location)
    this.config = params.config
    this.applicationDelegate = params.applicationDelegate
    this.deserializerManager = params.deserializerManager
    this.notificationManager = params.notificationManager
    this.viewRegistry = params.viewRegistry
    this.didActivate = params.didActivate

    this.emitter = new Emitter()

    this.paneContainer = new PaneContainer({
      location: this.location,
      config: this.config,
      applicationDelegate: this.applicationDelegate,
      deserializerManager: this.deserializerManager,
      notificationManager: this.notificationManager,
      viewRegistry: this.viewRegistry
    })

    this.state = {
      ready: false,
      size: null,
      visible: false
    }

    this.subscriptions = new CompositeDisposable(
      this.emitter,
      this.paneContainer.onDidActivatePane(() => {
        this.show()
        this.didActivate(this)
      }),
      this.paneContainer.observePanes(pane => {
        pane.onDidAddItem(this.handleDidAddPaneItem.bind(this))
        pane.onDidRemoveItem(this.handleDidRemovePaneItem.bind(this))
      }),
      this.paneContainer.onDidChangeActivePane((item) => params.didChangeActivePane(this, item)),
      this.paneContainer.onDidChangeActivePaneItem((item) => params.didChangeActivePaneItem(this, item)),
      this.paneContainer.onDidDestroyPaneItem((item) => params.didDestroyPaneItem(item))
    )

    etch.initialize(this)
  }

  // This method is called explicitly by the object which adds the Dock to the document.
  elementAttached () {
    // Re-render when the dock is attached to make sure we remeasure sizes defined in CSS.
    etch.updateSync(this)
  }

  getElement () {
    if (!this.state.ready) {
      // Render the element with its contents for the first time. This needs to be deferred so it's
      // not done when snapshotting.
      this.setState({ready: true})
      etch.updateSync(this)
    }
    return this.element
  }

  getLocation () {
    return this.location
  }

  destroy () {
    this.subscriptions.dispose()
    this.paneContainer.destroy()
    window.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('mouseup', this.handleMouseUp)
  }

  // Extended: Show the dock and focus its active {Pane}.
  activate () {
    this.getActivePane().activate()
  }

  // Extended: Show the dock without focusing it.
  show () {
    this.setState({visible: true})
  }

  // Extended: Hide the dock and activate the {WorkspaceCenter} if the dock was
  // was previously focused.
  hide () {
    this.setState({visible: false})
  }

  // Extended: Toggle the dock's visibility without changing the {Workspace}'s
  // active pane container.
  toggle () {
    const state = {visible: !this.state.visible}
    this.setState(state)
  }

  // Extended: Check if the dock is visible.
  //
  // Returns a {Boolean}.
  isVisible () {
    return this.state.visible
  }

  setState (newState) {
    const prevState = this.state
    const nextState = Object.assign({}, prevState, newState)
    this.state = nextState

    const {visible} = this.state

    // Render immediately if the dock becomes visible or the size changes in case people are
    // measuring after opening, for example.
    if ((visible && !prevState.visible) || (this.state.size !== prevState.size)) etch.updateSync(this)
    else etch.update(this)

    if (visible !== prevState.visible) {
      this.emitter.emit('did-change-visible', visible)
    }
  }

  render () {
    const atomDock = (size, ...children) => $('atom-dock',
      {
        className: this.location,
        style: {[this.widthOrHeight]: `${this.state.visible ? size : 0}px`}
      },
      ...children
    )

    // Because this code is included in the snapshot, we have to make sure we don't load
    // DOM-touching classes (like PaneContainerElement) during initialization. The way we do this
    // is by avoiding rendering the full contents until the element is attached, at which point we
    // toggle the `ready` state and render the full dock contents.
    if (!this.state.ready) return atomDock(0, [])

    const cursorOverlayElementClassList = ['atom-dock-cursor-overlay', this.location]
    if (this.state.resizing) cursorOverlayElementClassList.push(CURSOR_OVERLAY_VISIBLE_CLASS)

    const size = Math.max(MINIMUM_SIZE, this.state.size || DEFAULT_INITIAL_SIZE)

    return atomDock(
      size,
      $(DockResizeHandle, {
        location: this.location,
        onResizeStart: this.handleResizeHandleDragStart,
        onResizeToFit: this.handleResizeToFit,
        dockIsVisible: this.state.visible
      }),
      $(ElementComponent, {element: this.paneContainer.getElement()}),
      $.div({className: cursorOverlayElementClassList.join(' ')})
    )
  }

  update (props) {
    // Since we're interopping with non-etch stuff, this method's actually never called.
    return etch.update(this)
  }

  handleDidAddPaneItem () {
    if (this.state.size == null) {
      this.setState({size: this.getInitialSize()})
    }
  }

  handleDidRemovePaneItem () {
    // Hide the dock if you remove the last item.
    if (this.paneContainer.getPaneItems().length === 0) {
      this.setState({visible: false, size: null})
    }
  }

  handleResizeHandleDragStart () {
    window.addEventListener('mousemove', this.handleMouseMove)
    window.addEventListener('mouseup', this.handleMouseUp)
    this.setState({resizing: true})
  }

  handleResizeToFit () {
    const item = this.getActivePaneItem()
    if (item) {
      const size = getPreferredSize(item, this.getLocation())
      if (size != null) this.setState({size})
    }
  }

  handleMouseMove (event) {
    if (event.buttons === 0) { // We missed the mouseup event. For some reason it happens on Windows
      this.handleMouseUp(event)
      return
    }

    let size = 0
    switch (this.location) {
      case 'left':
        size = event.pageX - this.element.getBoundingClientRect().left
        break
      case 'bottom':
        size = this.element.getBoundingClientRect().bottom - event.pageY
        break
      case 'right':
        size = this.element.getBoundingClientRect().right - event.pageX
        break
    }
    this.setState({size})
  }

  handleMouseUp (event) {
    window.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('mouseup', this.handleMouseUp)
    this.setState({resizing: false})
  }

  getInitialSize () {
    // The item may not have been activated yet. If that's the case, just use the first item.
    const activePaneItem = this.paneContainer.getActivePaneItem() || this.paneContainer.getPaneItems()[0]
    // If there are items, we should have an explicit width; if not, we shouldn't.
    return activePaneItem
      ? getPreferredSize(activePaneItem, this.location) || DEFAULT_INITIAL_SIZE
      : null
  }

  serialize () {
    return {
      deserializer: 'Dock',
      size: this.state.size,
      paneContainer: this.paneContainer.serialize(),
      visible: this.state.visible
    }
  }

  deserialize (serialized, deserializerManager) {
    this.paneContainer.deserialize(serialized.paneContainer, deserializerManager)
    this.setState({
      size: serialized.size || this.getInitialSize(),
      // If no items could be deserialized, we don't want to show the dock (even if it was visible last time)
      visible: serialized.visible && (this.paneContainer.getPaneItems().length > 0)
    })
  }

  /*
  Section: Event Subscription
  */

  // Essential: Invoke the given callback when the visibility of the dock changes.
  //
  // * `callback` {Function} to be called when the visibility changes.
  //   * `visible` {Boolean} Is the dock now visible?
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidChangeVisible (callback) {
    return this.emitter.on('did-change-visible', callback)
  }

  // Essential: Invoke the given callback with the current and all future visibilities of the dock.
  //
  // * `callback` {Function} to be called when the visibility changes.
  //   * `visible` {Boolean} Is the dock now visible?
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  observeVisible (callback) {
    callback(this.isVisible())
    return this.onDidChangeVisible(callback)
  }

  // Essential: Invoke the given callback with all current and future panes items
  // in the dock.
  //
  // * `callback` {Function} to be called with current and future pane items.
  //   * `item` An item that is present in {::getPaneItems} at the time of
  //      subscription or that is added at some later time.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  observePaneItems (callback) {
    return this.paneContainer.observePaneItems(callback)
  }

  // Essential: Invoke the given callback when the active pane item changes.
  //
  // Because observers are invoked synchronously, it's important not to perform
  // any expensive operations via this method. Consider
  // {::onDidStopChangingActivePaneItem} to delay operations until after changes
  // stop occurring.
  //
  // * `callback` {Function} to be called when the active pane item changes.
  //   * `item` The active pane item.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidChangeActivePaneItem (callback) {
    return this.paneContainer.onDidChangeActivePaneItem(callback)
  }

  // Essential: Invoke the given callback when the active pane item stops
  // changing.
  //
  // Observers are called asynchronously 100ms after the last active pane item
  // change. Handling changes here rather than in the synchronous
  // {::onDidChangeActivePaneItem} prevents unneeded work if the user is quickly
  // changing or closing tabs and ensures critical UI feedback, like changing the
  // highlighted tab, gets priority over work that can be done asynchronously.
  //
  // * `callback` {Function} to be called when the active pane item stopts
  //   changing.
  //   * `item` The active pane item.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidStopChangingActivePaneItem (callback) {
    return this.paneContainer.onDidStopChangingActivePaneItem(callback)
  }

  // Essential: Invoke the given callback with the current active pane item and
  // with all future active pane items in the dock.
  //
  // * `callback` {Function} to be called when the active pane item changes.
  //   * `item` The current active pane item.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  observeActivePaneItem (callback) {
    return this.paneContainer.observeActivePaneItem(callback)
  }

  // Extended: Invoke the given callback when a pane is added to the dock.
  //
  // * `callback` {Function} to be called panes are added.
  //   * `event` {Object} with the following keys:
  //     * `pane` The added pane.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidAddPane (callback) {
    return this.paneContainer.onDidAddPane(callback)
  }

  // Extended: Invoke the given callback before a pane is destroyed in the
  // dock.
  //
  // * `callback` {Function} to be called before panes are destroyed.
  //   * `event` {Object} with the following keys:
  //     * `pane` The pane to be destroyed.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onWillDestroyPane (callback) {
    return this.paneContainer.onWillDestroyPane(callback)
  }

  // Extended: Invoke the given callback when a pane is destroyed in the dock.
  //
  // * `callback` {Function} to be called panes are destroyed.
  //   * `event` {Object} with the following keys:
  //     * `pane` The destroyed pane.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidDestroyPane (callback) {
    return this.paneContainer.onDidDestroyPane(callback)
  }

  // Extended: Invoke the given callback with all current and future panes in the
  // dock.
  //
  // * `callback` {Function} to be called with current and future panes.
  //   * `pane` A {Pane} that is present in {::getPanes} at the time of
  //      subscription or that is added at some later time.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  observePanes (callback) {
    return this.paneContainer.observePanes(callback)
  }

  // Extended: Invoke the given callback when the active pane changes.
  //
  // * `callback` {Function} to be called when the active pane changes.
  //   * `pane` A {Pane} that is the current return value of {::getActivePane}.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidChangeActivePane (callback) {
    return this.paneContainer.onDidChangeActivePane(callback)
  }

  // Extended: Invoke the given callback with the current active pane and when
  // the active pane changes.
  //
  // * `callback` {Function} to be called with the current and future active#
  //   panes.
  //   * `pane` A {Pane} that is the current return value of {::getActivePane}.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  observeActivePane (callback) {
    return this.paneContainer.observeActivePane(callback)
  }

  // Extended: Invoke the given callback when a pane item is added to the dock.
  //
  // * `callback` {Function} to be called when pane items are added.
  //   * `event` {Object} with the following keys:
  //     * `item` The added pane item.
  //     * `pane` {Pane} containing the added item.
  //     * `index` {Number} indicating the index of the added item in its pane.
  //
  // Returns a {Disposable} on which `.dispose()` can be called to unsubscribe.
  onDidAddPaneItem (callback) {
    return this.paneContainer.onDidAddPaneItem(callback)
  }

  // Extended: Invoke the given callback when a pane item is about to be
  // destroyed, before the user is prompted to save it.
  //
  // * `callback` {Function} to be called before pane items are destroyed.
  //   * `event` {Object} with the following keys:
  //     * `item` The item to be destroyed.
  //     * `pane` {Pane} containing the item to be destroyed.
  //     * `index` {Number} indicating the index of the item to be destroyed in
  //       its pane.
  //
  // Returns a {Disposable} on which `.dispose` can be called to unsubscribe.
  onWillDestroyPaneItem (callback) {
    return this.paneContainer.onWillDestroyPaneItem(callback)
  }

  // Extended: Invoke the given callback when a pane item is destroyed.
  //
  // * `callback` {Function} to be called when pane items are destroyed.
  //   * `event` {Object} with the following keys:
  //     * `item` The destroyed item.
  //     * `pane` {Pane} containing the destroyed item.
  //     * `index` {Number} indicating the index of the destroyed item in its
  //       pane.
  //
  // Returns a {Disposable} on which `.dispose` can be called to unsubscribe.
  onDidDestroyPaneItem (callback) {
    return this.paneContainer.onDidDestroyPaneItem(callback)
  }

  /*
  Section: Pane Items
  */

  // Essential: Get all pane items in the dock.
  //
  // Returns an {Array} of items.
  getPaneItems () {
    return this.paneContainer.getPaneItems()
  }

  // Essential: Get the active {Pane}'s active item.
  //
  // Returns an pane item {Object}.
  getActivePaneItem () {
    return this.paneContainer.getActivePaneItem()
  }

  // Deprecated: Get the active item if it is a {TextEditor}.
  //
  // Returns a {TextEditor} or `undefined` if the current active item is not a
  // {TextEditor}.
  getActiveTextEditor () {
    Grim.deprecate('Text editors are not allowed in docks. Use atom.workspace.getActiveTextEditor() instead.')

    const activeItem = this.getActivePaneItem()
    if (activeItem instanceof TextEditor) { return activeItem }
  }

  // Save all pane items.
  saveAll () {
    this.paneContainer.saveAll()
  }

  confirmClose (options) {
    return this.paneContainer.confirmClose(options)
  }

  /*
  Section: Panes
  */

  // Extended: Get all panes in the dock.
  //
  // Returns an {Array} of {Pane}s.
  getPanes () {
    return this.paneContainer.getPanes()
  }

  // Extended: Get the active {Pane}.
  //
  // Returns a {Pane}.
  getActivePane () {
    return this.paneContainer.getActivePane()
  }

  // Extended: Make the next pane active.
  activateNextPane () {
    return this.paneContainer.activateNextPane()
  }

  // Extended: Make the previous pane active.
  activatePreviousPane () {
    return this.paneContainer.activatePreviousPane()
  }

  paneForURI (uri) {
    return this.paneContainer.paneForURI(uri)
  }

  paneForItem (item) {
    return this.paneContainer.paneForItem(item)
  }

  // Destroy (close) the active pane.
  destroyActivePane () {
    const activePane = this.getActivePane()
    if (activePane != null) {
      activePane.destroy()
    }
  }
}

class DockResizeHandle {
  constructor (props) {
    this.props = props
    etch.initialize(this)
  }

  render () {
    const classList = ['atom-dock-resize-handle', this.props.location]
    if (this.props.dockIsVisible) classList.push(RESIZE_HANDLE_RESIZABLE_CLASS)

    return $.div({
      className: classList.join(' '),
      on: {mousedown: this.handleMouseDown}
    })
  }

  getElement () {
    return this.element
  }

  getSize () {
    if (!this.size) {
      this.size = this.element.getBoundingClientRect()[getWidthOrHeight(this.props.location)]
    }
    return this.size
  }

  update (newProps) {
    this.props = Object.assign({}, this.props, newProps)
    return etch.update(this)
  }

  handleMouseDown (event) {
    if (event.detail === 2) {
      this.props.onResizeToFit()
    } else if (this.props.dockIsVisible) {
      this.props.onResizeStart()
    }
  }
}

// An etch component that doesn't use etch, this component provides a gateway from JSX back into
// the mutable DOM world.
class ElementComponent {
  constructor (props) {
    this.element = props.element
  }

  update (props) {
    this.element = props.element
  }
}

function getWidthOrHeight (location) {
  return location === 'left' || location === 'right' ? 'width' : 'height'
}

function getPreferredSize (item, location) {
  switch (location) {
    case 'left':
    case 'right':
      return typeof item.getPreferredWidth === 'function'
        ? item.getPreferredWidth()
        : null
    default:
      return typeof item.getPreferredHeight === 'function'
        ? item.getPreferredHeight()
        : null
  }
}

'use strict'

const {ipcRenderer} = require('electron')
const path = require('path')
const fs = require('fs-plus')
const {CompositeDisposable} = require('event-kit')
const scrollbarStyle = require('scrollbar-style')

class WorkspaceElement extends HTMLElement {
  attachedCallback () {
    this.focus()
  }

  detachedCallback () {
    this.subscriptions.dispose()
  }

  initializeContent () {
    this.classList.add('workspace')
    this.setAttribute('tabindex', -1)

    this.verticalAxis = document.createElement('atom-workspace-axis')
    this.verticalAxis.classList.add('vertical')

    this.horizontalAxis = document.createElement('atom-workspace-axis')
    this.horizontalAxis.classList.add('horizontal')
    this.horizontalAxis.appendChild(this.verticalAxis)

    this.appendChild(this.horizontalAxis)
  }

  observeScrollbarStyle () {
    this.subscriptions.add(scrollbarStyle.observePreferredScrollbarStyle(style => {
      switch (style) {
        case 'legacy':
          this.classList.remove('scrollbars-visible-when-scrolling')
          this.classList.add('scrollbars-visible-always')
          break
        case 'overlay':
          this.classList.remove('scrollbars-visible-always')
          this.classList.add('scrollbars-visible-when-scrolling')
          break
      }
    }))
  }

  observeTextEditorFontConfig () {
    this.updateGlobalTextEditorStyleSheet()
    this.subscriptions.add(this.config.onDidChange('editor.fontSize', this.updateGlobalTextEditorStyleSheet.bind(this)))
    this.subscriptions.add(this.config.onDidChange('editor.fontFamily', this.updateGlobalTextEditorStyleSheet.bind(this)))
    this.subscriptions.add(this.config.onDidChange('editor.lineHeight', this.updateGlobalTextEditorStyleSheet.bind(this)))
  }

  updateGlobalTextEditorStyleSheet () {
    const styleSheetSource = `atom-workspace {
  --editor-font-size: ${this.config.get('editor.fontSize')}px;
  --editor-font-family: ${this.config.get('editor.fontFamily')};
  --editor-line-height: ${this.config.get('editor.lineHeight')};
}`
    this.styleManager.addStyleSheet(styleSheetSource, {sourcePath: 'global-text-editor-styles', priority: -1})
  }

  initialize (model, {config, project, styleManager, viewRegistry}) {
    this.model = model
    this.viewRegistry = viewRegistry
    this.project = project
    this.config = config
    this.styleManager = styleManager
    if (this.viewRegistry == null) { throw new Error('Must pass a viewRegistry parameter when initializing WorkspaceElements') }
    if (this.project == null) { throw new Error('Must pass a project parameter when initializing WorkspaceElements') }
    if (this.config == null) { throw new Error('Must pass a config parameter when initializing WorkspaceElements') }
    if (this.styleManager == null) { throw new Error('Must pass a styleManager parameter when initializing WorkspaceElements') }

    this.subscriptions = new CompositeDisposable()
    this.initializeContent()
    this.observeScrollbarStyle()
    this.observeTextEditorFontConfig()

    this.paneContainer = this.model.getCenter().paneContainer.getElement()
    this.verticalAxis.appendChild(this.paneContainer)
    this.addEventListener('focus', this.handleFocus.bind(this))

    this.addEventListener('mousewheel', this.handleMousewheel.bind(this), true)

    this.panelContainers = {
      top: this.model.panelContainers.top.getElement(),
      left: this.model.panelContainers.left.getElement(),
      right: this.model.panelContainers.right.getElement(),
      bottom: this.model.panelContainers.bottom.getElement(),
      header: this.model.panelContainers.header.getElement(),
      footer: this.model.panelContainers.footer.getElement(),
      modal: this.model.panelContainers.modal.getElement()
    }

    this.horizontalAxis.insertBefore(this.panelContainers.left, this.verticalAxis)
    this.horizontalAxis.appendChild(this.panelContainers.right)

    this.verticalAxis.insertBefore(this.panelContainers.top, this.paneContainer)
    this.verticalAxis.appendChild(this.panelContainers.bottom)

    this.insertBefore(this.panelContainers.header, this.horizontalAxis)
    this.appendChild(this.panelContainers.footer)

    this.appendChild(this.panelContainers.modal)

    return this
  }

  destroy () {
    this.subscriptions.dispose()
  }

  getModel () { return this.model }

  handleMousewheel (event) {
    if (event.ctrlKey && this.config.get('editor.zoomFontWhenCtrlScrolling') && (event.target.closest('atom-text-editor') != null)) {
      if (event.wheelDeltaY > 0) {
        this.model.increaseFontSize()
      } else if (event.wheelDeltaY < 0) {
        this.model.decreaseFontSize()
      }
      event.preventDefault()
      event.stopPropagation()
    }
  }

  handleFocus (event) {
    this.model.getActivePane().activate()
  }

  focusPaneViewAbove () { this.focusPaneViewInDirection('above') }

  focusPaneViewBelow () { this.focusPaneViewInDirection('below') }

  focusPaneViewOnLeft () { this.focusPaneViewInDirection('left') }

  focusPaneViewOnRight () { this.focusPaneViewInDirection('right') }

  focusPaneViewInDirection (direction, pane) {
    const activePane = this.model.getActivePane()
    const paneToFocus = this.nearestVisiblePaneInDirection(direction, activePane)
    paneToFocus && paneToFocus.focus()
  }

  moveActiveItemToPaneAbove (params) {
    this.moveActiveItemToNearestPaneInDirection('above', params)
  }

  moveActiveItemToPaneBelow (params) {
    this.moveActiveItemToNearestPaneInDirection('below', params)
  }

  moveActiveItemToPaneOnLeft (params) {
    this.moveActiveItemToNearestPaneInDirection('left', params)
  }

  moveActiveItemToPaneOnRight (params) {
    this.moveActiveItemToNearestPaneInDirection('right', params)
  }

  moveActiveItemToNearestPaneInDirection (direction, params) {
    const activePane = this.model.getActivePane()
    const nearestPaneView = this.nearestVisiblePaneInDirection(direction, activePane)
    if (nearestPaneView == null) { return }
    if (params && params.keepOriginal) {
      activePane.getContainer().copyActiveItemToPane(nearestPaneView.getModel())
    } else {
      activePane.getContainer().moveActiveItemToPane(nearestPaneView.getModel())
    }
    nearestPaneView.focus()
  }

  nearestVisiblePaneInDirection (direction, pane) {
    const distance = function (pointA, pointB) {
      const x = pointB.x - pointA.x
      const y = pointB.y - pointA.y
      return Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2))
    }

    const paneView = pane.getElement()
    const box = this.boundingBoxForPaneView(paneView)

    const paneViews = atom.workspace.getVisiblePanes()
      .map(otherPane => otherPane.getElement())
      .filter(otherPaneView => {
        const otherBox = this.boundingBoxForPaneView(otherPaneView)
        switch (direction) {
          case 'left': return otherBox.right.x <= box.left.x
          case 'right': return otherBox.left.x >= box.right.x
          case 'above': return otherBox.bottom.y <= box.top.y
          case 'below': return otherBox.top.y >= box.bottom.y
        }
      }).sort((paneViewA, paneViewB) => {
        const boxA = this.boundingBoxForPaneView(paneViewA)
        const boxB = this.boundingBoxForPaneView(paneViewB)
        switch (direction) {
          case 'left': return distance(box.left, boxA.right) - distance(box.left, boxB.right)
          case 'right': return distance(box.right, boxA.left) - distance(box.right, boxB.left)
          case 'above': return distance(box.top, boxA.bottom) - distance(box.top, boxB.bottom)
          case 'below': return distance(box.bottom, boxA.top) - distance(box.bottom, boxB.top)
        }
      })

    return paneViews[0]
  }

  boundingBoxForPaneView (paneView) {
    const boundingBox = paneView.getBoundingClientRect()

    return {
      left: {x: boundingBox.left, y: boundingBox.top},
      right: {x: boundingBox.right, y: boundingBox.top},
      top: {x: boundingBox.left, y: boundingBox.top},
      bottom: {x: boundingBox.left, y: boundingBox.bottom}
    }
  }

  runPackageSpecs () {
    const activePaneItem = this.model.getActivePaneItem()
    const activePath = activePaneItem && typeof activePaneItem.getPath === 'function' ? activePaneItem.getPath() : null
    let projectPath
    if (activePath != null) {
      [projectPath] = this.project.relativizePath(activePath)
    } else {
      [projectPath] = this.project.getPaths()
    }
    if (projectPath) {
      let specPath = path.join(projectPath, 'spec')
      const testPath = path.join(projectPath, 'test')
      if (!fs.existsSync(specPath) && fs.existsSync(testPath)) {
        specPath = testPath
      }

      ipcRenderer.send('run-package-specs', specPath)
    }
  }

  runBenchmarks () {
    const activePaneItem = this.model.getActivePaneItem()
    const activePath = activePaneItem && typeof activePaneItem.getPath === 'function' ? activePaneItem.getPath() : null
    let projectPath
    if (activePath) {
      [projectPath] = this.project.relativizePath(activePath)
    } else {
      [projectPath] = this.project.getPaths()
    }

    if (projectPath) {
      ipcRenderer.send('run-benchmarks', path.join(projectPath, 'benchmarks'))
    }
  }
}

module.exports = document.registerElement('atom-workspace', {prototype: WorkspaceElement.prototype})

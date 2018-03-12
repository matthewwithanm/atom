const DockPane = require('./dock-pane')
const PaneContainer = require('./pane-container')

module.exports =
class DockPaneContainer extends PaneContainer {
  createPane (options) { return new DockPane(options) }

  getElement () {
    throw new Error("Model shouldn't create view")
  }

  deserialize (state, deserializerManager) {
    if (state.root) state.root.deserializer = 'DockPane'
    return super.deserialize(state, deserializerManager)
  }

  serialize () {
    const serialized = super.serialize()
    serialized.deserializer = 'DockPaneContainer'
    return serialized
  }
}

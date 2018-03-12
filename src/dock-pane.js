const Pane = require('./pane')

module.exports =
class DockPane extends Pane {
  static deserialize (state, {deserializers, applicationDelegate, config, notifications, views}) {
    const {activeItemIndex} = state
    const activeItemURI = state.activeItemURI || state.activeItemUri

    const items = []
    for (const itemState of state.items) {
      const item = deserializers.deserialize(itemState)
      if (item) items.push(item)
    }
    state.items = items

    state.activeItem = items[activeItemIndex]
    if (!state.activeItem && activeItemURI) {
      state.activeItem = state.items.find((item) =>
        typeof item.getURI === 'function' && item.getURI() === activeItemURI
      )
    }

    return new DockPane(Object.assign(state, {
      deserializerManager: deserializers,
      notificationManager: notifications,
      viewRegistry: views,
      config,
      applicationDelegate
    }))
  }

  getElement () {
    throw new Error("Model shouldn't create view")
  }

  serialize () {
    const serialized = super.serialize()
    serialized.deserializer = 'DockPane'
    return serialized
  }
}

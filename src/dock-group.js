const invariant = require('assert')
const etch = require('etch')
const {CompositeDisposable} = require('event-kit')

const $ = etch.dom

module.exports =
class DockGroup {
  constructor (props) {
    this.handleDidChangeItems = this.handleDidChangeItems.bind(this)

    this.props = props
    const {pane} = props
    this.state = {
      items: pane.getItems()
    }
    this.subscriptions = new CompositeDisposable(
      pane.onDidAddItem(this.handleDidChangeItems),
      pane.onDidRemoveItem(this.handleDidChangeItems),
      pane.onDidMoveItem(this.handleDidChangeItems)
    )
    etch.initialize(this)
  }

  handleDidChangeItems () {
    this.setState({items: this.props.pane.getItems()})
  }

  render () {
    const {items} = this.state
    return $(
      'atom-dock-group',
      {style: {display: 'flex', width: '100%', height: '100%'}},
      ...intersperse(
        items.map(item =>
          $.div(
            {style: {overflow: 'hidden', flex: 1 / items.length}},
            // TODO: Put a header here for vertical docks only?
            //$(ElementComponent, {key: item, element: atom.views.getView(item)})
            item.getTitle()
          )
        ),
        index => $('atom-dock-group-divider', {className: this.props.orientation})
      )
    )
  }

  setState (state) {
    this.state = Object.assign({}, this.state, state)
    etch.update(this)
  }

  update (props) {
    const prevProps = this.props
    const nextProps = Object.assign({}, this.props, props)

    // For now at least, let's not let the pane change.
    invariant(nextProps.pane === prevProps.pane, "Dock group panes can't change")

    this.props = nextProps
    etch.update(this)
  }

  destroy () {
    this.subscriptions.dispose()
  }
}

function intersperse (list, factory) {
  const result = []
  list.forEach((item, i) => {
    result.push(item)
    if (i < list.length - 1) result.push(factory(i))
  })
  return result
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

const invariant = require('assert')
const etch = require('etch')
const DockGroup = require('./dock-group')
const {CompositeDisposable} = require('event-kit')

const $ = etch.dom

module.exports =
class DockGroupContainer {
  constructor (props) {
    this.props = props
    const {paneContainer} = props
    this.state = {
      activePane: paneContainer.getActivePane()
    }
    this.subscriptions = new CompositeDisposable(
      paneContainer.onDidChangeActivePane(activePane => {
        this.setState({activePane})
      })
    )
    etch.initialize(this)
  }

  render () {
    return $(
      'atom-dock-group-container',
      {style: {flex: 1}},
      $(DockGroup, {
        key: this.state.activePane,
        orientation: this.props.orientation,
        pane: this.state.activePane
      })
    )
  }

  setState (state) {
    this.state = Object.assign({}, this.state, state)
    etch.update(this)
  }

  update (props) {
    const prevProps = this.props
    const nextProps = Object.assign({}, this.props, props)

    // For now at least, let's not let the paneContainer change.
    invariant(nextProps.paneContainer === prevProps.paneContainer)

    this.props = nextProps
    etch.update(this)
  }

  destroy () {
    this.subscriptions.dispose()
  }
}

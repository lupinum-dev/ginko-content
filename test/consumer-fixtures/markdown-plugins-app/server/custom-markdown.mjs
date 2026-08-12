export default () => ({
  name: 'packed-custom',
  post(state) {
    state.tree.nodes.unshift(['p', {}, 'Custom parser plugin active'])
  }
})

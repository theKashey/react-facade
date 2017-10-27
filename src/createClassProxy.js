import {Component} from 'react';
import find from 'lodash/find';
import transferStaticProps from './staticProps';

const GENERATION = '__facade__proxyGeneration';
const REGENERATION = '__facade__regenerateByEval'

function getDisplayName(Component) {
  const displayName = Component.displayName || Component.name;
  return (displayName && displayName !== 'ReactComponent')
    ? displayName
    : 'Unknown';
}

// This was originally a WeakMap but we had issues with React Native:
// https://github.com/gaearon/react-proxy/issues/50#issuecomment-192928066
let allProxies = [];
function findProxy(Component) {
  const pair = find(allProxies, ([key]) => key === Component);
  return pair ? pair[1] : null;
}
function addProxy(Component, proxy) {
  allProxies.push([Component, proxy]);
}

function isClass(Component) {
  return Component.prototype && Component.prototype.isReactComponent;
}

const lifeCycleMethods = [
  'componentWillMount',
  'componentDidMount',
  // 'componentWillUnmount',
  // 'componentDidUnmout',
];

function checkClassMembers(ProxyComponent, NextComponent) {
  const injectedCode = {};
  try {
    const ins1 = new ProxyComponent({}, {});
    const ins2 = new NextComponent({}, {});
    const mergeProps = Object.assign({}, ins1, ins2);
    Object
      .keys(mergeProps)
      .filter(key => !key.startsWith('__facade__'))
      .forEach(function (key) {
        if (("" + ins1[key]) != ("" + ins2[key])) {

          if(!ins1[REGENERATION]){
            console.error('React-facade:', ' Updated class ', ProxyComponent.name, 'had different code for', key, ins2[key], '. Unable to reproduce');
          } else {
            injectedCode[key] = ins2[key];
          }
        }
      });
  } catch (e) {

  }
  return injectedCode;
}

function checkLifeCycleMethods(ProxyComponent, NextComponent) {
  try {
    const p1 = ProxyComponent.prototype;
    const p2 = NextComponent.prototype;
    lifeCycleMethods
      .forEach(function (key) {
        if (("" + p1[key]) != ("" + p2[key])) {
          console.error('React-facade:', 'You did update', ProxyComponent.name, '\s lifecycle method', key, p2[key], '. Unable to repeat');
        }
      });
  } catch (e) {

  }
}

function proxyClass(InitialComponent) {
  // Prevent double wrapping.
  // Given a proxy class, return the existing proxy managing it.
  var existingProxy = findProxy(InitialComponent);
  if (existingProxy) {
    return existingProxy;
  }

  let CurrentComponent;
  let ProxyComponent;
  let savedDescriptors = {};
  let injectedMembers = {};
  let proxyGeneration = 0;

  let inject = (target) => {
    if(target[GENERATION]!=proxyGeneration){
      Object
        .keys(injectedMembers)
        .forEach(key => target[REGENERATION](key, injectedMembers[key]));

      target[GENERATION]=proxyGeneration;
    }
  }

  let StatelessProxyComponent = class StatelessProxyComponent extends Component {
    render() {
      return CurrentComponent(this.props, this.context);
    }
  };

  let InitialParent = isClass(InitialComponent)
    ? InitialComponent
    : StatelessProxyComponent;

  ProxyComponent = class ProxiedComponent extends InitialParent {
    constructor(props, context) {
      super(props, context);
      this[GENERATION] = proxyGeneration;
    }
    render() {
      inject(this);
      return isClass(CurrentComponent)
        ? CurrentComponent.prototype.render.call(this)
        : CurrentComponent(this.props, this.context);
    }
  };

  ProxyComponent.toString = function toString() {
    return CurrentComponent.toString();
  };

  function update(NextComponent) {
    if (typeof NextComponent !== 'function') {
      throw new Error('Expected a constructor.');
    }
    if (NextComponent === CurrentComponent) {
      return;
    }

    // Prevent proxy cycles
    var existingProxy = findProxy(NextComponent);
    if (existingProxy) {
      return update(existingProxy.__getCurrent());
    }

    proxyGeneration++;

    // Save the next constructor so we call it
    const PreviousComponent = CurrentComponent;
    CurrentComponent = NextComponent;

    // Try to infer displayName

    let displayName = getDisplayName(NextComponent);
    ProxyComponent.displayName = displayName;

    try {
      Object.defineProperty(ProxyComponent, 'name', {
        value: displayName
      });
    } catch (err) {
    }

    savedDescriptors = transferStaticProps(ProxyComponent, savedDescriptors, PreviousComponent, NextComponent);

    if (isClass(NextComponent)) {
      checkLifeCycleMethods(ProxyComponent, NextComponent);
      Object.setPrototypeOf(ProxyComponent.prototype, NextComponent.prototype);
      injectedMembers = checkClassMembers(ProxyComponent, NextComponent);
    } else {
      ProxyComponent.prototype.prototype = StatelessProxyComponent.prototype;
      injectedMembers = {};
    }
  };

  function get() {
    return ProxyComponent;
  }

  function getCurrent() {
    return CurrentComponent;
  }

  update(InitialComponent);

  const proxy = {get, update};
  addProxy(ProxyComponent, proxy);

  Object.defineProperty(proxy, '__getCurrent', {
    configurable: false,
    writable: false,
    enumerable: false,
    value: getCurrent
  });

  return proxy;
}

export default proxyClass;

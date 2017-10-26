import {Component} from 'react';
import find from 'lodash/find';
import transferStaticProps from './staticProps';

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
  try {
    const ins1 = new ProxyComponent({}, {});
    const ins2 = new NextComponent({}, {});
    const mergeProps = Object.assign({}, ins1, ins2);
    Object
      .keys(mergeProps)
      .forEach(function (key) {
        if (("" + ins1[key]) != ("" + ins2[key])) {
          console.error('React-facade:', ' updated class ', ProxyComponent.name, 'had different code for', key, ins2[key], '. Unable to reproduce');
        }
      });
  } catch (e) {

  }
}

function checkLifeCycleMethods(ProxyComponent, NextComponent) {
  try {
    const p1 = ProxyComponent.prototype;
    const p2 = NextComponent.prototype;
    lifeCycleMethods
      .forEach(function (key) {
        if (("" + p1[key]) != ("" + p2[key])) {
          console.error('React-facade:', ' updated class ', ProxyComponent.name, 'had different code for lifecycle method', key, p2[key], '. Unable to repeat');
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

  let StatelessProxyComponent = class StatelessProxyComponent extends Component {
    render() {
      return CurrentComponent(this.props, this.context);
    }
  };

  let InitialParent = isClass(InitialComponent)
    ? InitialComponent
    : StatelessProxyComponent;

  ProxyComponent = class ProxiedComponent extends InitialParent {
    render() {
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
      checkClassMembers(ProxyComponent, NextComponent);
    } else {
      ProxyComponent.prototype.prototype = StatelessProxyComponent.prototype;
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

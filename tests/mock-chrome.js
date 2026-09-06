/**
 * Mock Chrome Extension Environment for Node.js Testing
 */

export function createMockChrome() {
  const storageData = {};
  const listeners = [];

  const mock = {
    storage: {
      local: {
        async get(keys) {
          if (!keys) {
            return JSON.parse(JSON.stringify(storageData));
          }
          const res = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) {
            if (k in storageData) {
              res[k] = JSON.parse(JSON.stringify(storageData[k]));
            }
          }
          return res;
        },
        async set(items) {
          for (const [k, v] of Object.entries(items)) {
            storageData[k] = JSON.parse(JSON.stringify(v));
          }
        },
        async clear() {
          for (const k of Object.keys(storageData)) {
            delete storageData[k];
          }
        }
      }
    },
    runtime: {
      onMessage: {
        addListener(fn) {
          listeners.push(fn);
        }
      },
      getURL(path) {
        return `chrome-extension://mock-id/${path}`;
      },
      async sendMessage(message) {
        return new Promise((resolve, reject) => {
          let responded = false;
          const sendResponse = (res) => {
            responded = true;
            resolve(res);
          };

          for (const listener of listeners) {
            const isAsync = listener(message, {}, sendResponse);
            if (!isAsync && responded) return;
          }

          setTimeout(() => {
            if (!responded) {
              reject(new Error("No response from onMessage handler"));
            }
          }, 100);
        });
      }
    },
    _rawStorage: storageData,
    _listeners: listeners
  };

  return mock;
}

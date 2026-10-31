/** Replace this adapter for native storage; core models never read browser globals. */
export const orderStorage = {
  getPreference: () => localStorage.getItem("ordercheck.preferences.v1"),
  setPreference: (value: string) => localStorage.setItem("ordercheck.preferences.v1", value),
  getSession: () => sessionStorage.getItem("ordercheck.v2"),
  getLegacySession: () => sessionStorage.getItem("ordercheck.v1"),
  setSession: (value: string) => sessionStorage.setItem("ordercheck.v2", value),
  clearSession: () => { sessionStorage.removeItem("ordercheck.v1"); sessionStorage.removeItem("ordercheck.v2"); },
};

/* Sets the saved theme before anything is drawn, so there is no flash. Dark is the default. */
(function () {
  var t = "dark";
  try { if (localStorage.getItem("haveli:theme") === "light") t = "light"; } catch (e) {}
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.setAttribute("data-bg", "none");
  var m = document.querySelector("meta[name=theme-color]");
  if (m && t === "light") m.setAttribute("content", "#F3E9DC");
})();

import { createRouter, createWebHashHistory } from "vue-router";
import App from "../App.vue";

const components = import.meta.glob("@/pages/*/*vue");

const routeList = Object.keys(components).map((key) => {
  const path = key.split("/")[3];
  const component = components[key];

  return {
    path,
    name: path,
    component,
  };
});

const routes = [
  {
    path: "/",
    component: App,
    redirect: "/demo",
    children: routeList,
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/",
  },
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;

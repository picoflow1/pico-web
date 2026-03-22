const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const dataDir = __dirname;

function loadYaml(name) {
  const filePath = path.join(dataDir, name);
  return yaml.load(fs.readFileSync(filePath, "utf8"));
}

module.exports = () => {
  const sitetext = loadYaml("sitetext.yml");
  const style = loadYaml("style.yml");
  const navigation = loadYaml("navigation.yml");

  return {
    url: "",
    baseurl: "",
    title: "picoflow.io",
    email: "contact@picoflow.io",
    description: "Site description",
    author: "Don Young",
    logo: {
      path: "assets/img/logo2.png",
      height: 50,
    },
    locale: "en-US",
    analytics: {
      google: null,
    },
    data: {
      sitetext,
      style,
      navigation,
    },
  };
};

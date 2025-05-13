import { Command } from "commander";
import { generate } from "./generateMap";
import { watch } from "./watchFiles";

const program = new Command();
program.name("project2yaml").description("Generate YAML map of a Next.js project");

program
  .command("generate")
  .description("Scan once and output project2yaml.yaml")
  .action(generate);

program
  .command("watch")
  .description("Watch files and auto-generate map on change")
  .action(watch);

program.parse();
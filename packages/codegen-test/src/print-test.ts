import { OperationType, printComment, printElseThrow, printLines, printList, printSet } from "@linear/codegen-doc";
import { Sdk, SdkListField, SdkOperation, SdkPluginContext } from "@linear/codegen-sdk";
import { getLast, nonNullable } from "@linear/common";
import { printAfterAll, printBeforeAll, printBeforeSuite } from "./print-hooks";

/**
 * Print all tests
 */
export function printTests(context: SdkPluginContext): string {
  return printDescribe(
    "generated",
    ["Auto generated API tests"],
    printLines([
      printBeforeSuite(),
      printBeforeAll(),
      printAfterAll(),
      ...context.sdkDefinitions[""].operations?.map(operation =>
        operation.node.operation === OperationType.query ? printQueryTest(context, operation) : undefined
      ),
    ])
  );
}

/**
 * Print a jest describe block
 */
function printDescribe(name: string, description: string[], content: string, omit = false): string {
  return omit
    ? content
    : printLines([
        printComment(description),
        `describe("${name}", () => {
          ${content}
        })`,
        "\n",
      ]);
}

/**
 * Print a jest it block
 */
function printIt(name: string, content: string): string {
  return printLines([
    `it("${name}", async () => {
      ${content}
    })`,
    "\n",
  ]);
}

/**
 * Find the model field for the connection nodes
 */
function getConnectionNode(operation: SdkOperation): SdkListField | undefined {
  return operation.model?.fields.list.find(field => field.name === Sdk.NODE_NAME);
}

/**
 * Print mocked arguments for an operation
 */
function printOperationArgs(operation: SdkOperation): string {
  const parentArgNames = operation.parent?.requiredArgs.args.map(arg => arg.name) ?? [];
  const fieldMockArgs = operation.requiredArgs.args
    .map(arg =>
      parentArgNames.includes(arg.name)
        ? undefined
        : arg.type === "string"
        ? `"mock-${arg.name}"`
        : arg.type === "string[]"
        ? `["mock-${arg.name}"]`
        : arg.type === "number"
        ? `123`
        : arg.type === "number[]"
        ? `[123]`
        : "UNMAPPED_MOCK_TYPE"
    )
    .filter(nonNullable);

  return fieldMockArgs.length || operation.optionalArgs.args.length ? `(${printList(fieldMockArgs)})` : "";
}

/**
 * Prints the test for a query with associated SdkModel
 */
function printModelQueryTest(context: SdkPluginContext, operation: SdkOperation, index = 1): string {
  const sdkKey = operation.sdkPath.join("_");
  const sdkOperations = context.sdkDefinitions[operation.path.join("_")]?.operations ?? [];
  const clientName = getLast(operation.sdkPath) ? `_${getLast(operation.sdkPath)}` : "client";

  const fieldName = getLast(operation.path) ?? "UNKNOWN_FIELD_NAME";
  const fieldType = printList([Sdk.NAMESPACE, operation.print.model], ".");

  const isModelObject = operation.parent?.model?.fields.object.find(field => field.name === getLast(operation.path));

  /** Mock data for any queries with required variables that cannot be sourced via a connection */
  return printDescribe(
    operation.name,
    [`Test ${operation.name} query`],
    printLines([
      sdkOperations.length ? `let _${fieldName}: ${fieldType} | undefined` : undefined,
      "\n",
      printComment([`Test the ${sdkKey || "root"} model query for ${operation.name}`]),
      printIt(
        printList([sdkKey ? sdkKey : undefined, fieldName], "."),
        printElseThrow(
          clientName,
          printLines([
            `const ${fieldName} = ${
              isModelObject
                ? `${clientName}.${fieldName}`
                : `await ${clientName}.${fieldName}${printOperationArgs(operation)}`
            }`,
            sdkOperations.length ? printSet(`_${fieldName}`, fieldName) : undefined,
            `expect(${fieldName} instanceof ${fieldType})`,
          ]),
          `No ${getLast(operation.sdkPath)} found - cannot test ${clientName}.${fieldName} query`,
          clientName === "client"
        )
      ),
      printLines(sdkOperations.map(sdkOperation => printQueryTest(context, sdkOperation, index))),
    ]),
    operation.sdkPath.length > 0
  );
}

/**
 * Prints the test for a connection query
 */
function printConnectionQueryTest(context: SdkPluginContext, operation: SdkOperation, index = 1): string {
  const sdkKey = operation.sdkPath.join("_");
  const clientName = getLast(operation.sdkPath) ? `_${getLast(operation.sdkPath)}` : "client";

  const fieldName = getLast(operation.path) ?? "UNKNOWN_FIELD_NAME";
  const fieldType = printList([Sdk.NAMESPACE, operation.print.model], ".");

  const connectionType = getConnectionNode(operation)?.listType;

  const itemOperation = context.sdkDefinitions[sdkKey].operations.find(sdkOperation => {
    return sdkOperation.print.model === connectionType;
  });
  const itemField = itemOperation?.print.field;
  const itemSdkKey = itemOperation?.path.join("_");
  const itemOperations = itemSdkKey ? context.sdkDefinitions[itemSdkKey]?.operations ?? [] : [];
  const itemType = printList([Sdk.NAMESPACE, itemOperation?.print.model], ".");
  const itemArgs = itemOperation?.requiredArgs.args ?? [];
  const itemOperationArgs = itemArgs.length ? `(${printList(itemArgs.map(arg => `_${itemField}_${arg.name}`))})` : "";
  const itemQueries = itemOperation?.model?.fields.query ?? [];

  return printDescribe(
    operation.name,
    [`Test all ${connectionType} queries`],
    printLines([
      itemOperation
        ? printLines([
            `let _${itemField}: ${itemType} | undefined`,
            ...(itemArgs.map(arg => `let _${itemField}_${arg.name}: ${arg.type} | undefined`) ?? []),
            "\n",
          ])
        : undefined,
      printComment([`Test the ${sdkKey || "root"} connection query for the ${connectionType}`]),
      printIt(
        printList([sdkKey ? sdkKey : undefined, fieldName], "."),
        printElseThrow(
          clientName,
          printLines([
            `const ${fieldName} = await ${clientName}.${fieldName}${printOperationArgs(operation)}`,
            itemOperation
              ? printLines([
                  `const ${itemField} = ${fieldName}?.${Sdk.NODE_NAME}?.[0]`,
                  ...(itemArgs.map(arg => printSet(`_${itemField}_${arg.name}`, `${itemField}?.${arg.name}`)) ?? []),
                ])
              : undefined,
            `expect(${fieldName} instanceof ${fieldType})`,
          ]),
          `No ${getLast(operation.sdkPath)} found - cannot test ${clientName}.${fieldName} query`,
          clientName === "client"
        )
      ),

      "\n",

      ...(itemField
        ? [
            printComment([`Test the root query for a single ${connectionType}`]),
            printIt(
              printList([sdkKey ? sdkKey : undefined, itemField], "."),
              printElseThrow(
                printList(
                  itemArgs.map(arg => `_${itemField}_${arg.name}`),
                  " && "
                ),
                printLines([
                  `const ${itemField} = await ${clientName}.${itemField}${itemOperationArgs}`,
                  itemOperations.length || itemQueries.length ? printSet(`_${itemField}`, itemField) : undefined,
                  `expect(${itemField} instanceof ${itemType})`,
                ]),
                `No first ${connectionType} found in connection - cannot test ${itemField} query`
              )
            ),
          ]
        : []),
      "\n",

      printLines(itemOperations?.map(sdkOperation => printQueryTest(context, sdkOperation, index))),

      itemQueries.length
        ? printLines(
            itemQueries.map(field => {
              return printLines([
                printComment([`Test the ${itemField}.${field.name} query for ${field.type}`]),
                printIt(
                  printList([sdkKey ? sdkKey : undefined, itemField, field.name], "."),
                  printElseThrow(
                    `_${itemField}`,
                    printLines([
                      `const ${itemField}_${field.name} = await _${itemField}.${field.name}`,
                      `expect(${itemField}_${field.name} instanceof ${field.type})`,
                    ]),
                    `No ${connectionType} found - cannot test ${itemField}.${field.name} query`
                  )
                ),
              ]);
            })
          )
        : undefined,
    ]),
    operation.sdkPath.length > 0
  );
}

/**
 * Print tests for a query
 */
function printQueryTest(context: SdkPluginContext, operation: SdkOperation, index = 0): string {
  if (index > 2) {
    return "";
  }

  const sdkKey = operation.sdkPath.join("_");

  const connectionType = getConnectionNode(operation)?.listType;
  const connectionOperation = context.sdkDefinitions[sdkKey].operations.find(sdkOperation => {
    return getConnectionNode(sdkOperation)?.listType === operation.name;
  });

  if (connectionType) {
    /** Handle connection queries specifically */
    return printConnectionQueryTest(context, operation, index + 1);
  } else if (connectionOperation) {
    /** This operation is handled by the connection test */
    return "";
  } else if (operation.model) {
    /** Handle models without connections */
    return printModelQueryTest(context, operation, index + 1);
  } else {
    return printLines([`// ${operation.name} - no model for query`, "\n"]);
  }
}

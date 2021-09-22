import { CodeMaker } from "codemaker";
import { AttributeModel } from "../models";
import { downcaseFirst } from "../../../util";
import { CUSTOM_DEFAULTS } from "../custom-defaults";

type GetterType =
  | { _type: "plain" }
  | {
      _type: "args";
      args: string;
      returnType?: string;
      returnStatement: string;
    }
  | {
      _type: "stored_class";
    };

type SetterType =
  | { __type: "none" }
  | { __type: "set"; type: string }
  | { __type: "put"; type: string };

export class AttributesEmitter {
  constructor(private code: CodeMaker) {}

  public emit(att: AttributeModel, escapeReset: boolean, escapeInput: boolean) {
    this.code.line();
    this.code.line(
      `// ${att.terraformName} - computed: ${att.computed}, optional: ${att.isOptional}, required: ${att.isRequired}`
    );

    const isStored = att.isAssignable && !att.isConfigIgnored;
    const hasResetMethod = isStored && !att.isRequired;
    const hasInputMethod = isStored;

    let getterType: GetterType = { _type: "plain" };

    if (
      // Complex Computed List Map
      att.computed &&
      !att.isOptional &&
      att.type.isComputedComplex &&
      att.type.isList &&
      att.type.isMap
    ) {
      getterType = {
        _type: "args",
        args: "index: string, key: string",
        returnType: this.determineMapType(att),
        returnStatement: `new ${att.type.name}(this, \`${att.terraformName}.\${index}\`).lookup(key)`,
      };
    } else if (
      // Complex Computed List
      att.computed &&
      !att.isOptional &&
      att.type.isComputedComplex &&
      att.type.isList
    ) {
      getterType = {
        _type: "args",
        args: "index: string",
        returnStatement: `new ${att.type.name}(this, '${att.terraformName}', index)`,
      };
    } else if (
      // Complex Computed Map
      att.computed &&
      !att.isOptional &&
      att.type.isComputedComplex &&
      att.type.isMap
    ) {
      getterType = {
        _type: "args",
        args: "key: string",
        returnType: this.determineMapType(att),
        returnStatement: `new ${att.type.name}(this, '${att.terraformName}').lookup(key)`,
      };
    }

    if (att.type.isSingleItem && att.type.isComplex) {
      getterType = { _type: "stored_class" };
    }

    let setterType: SetterType = isStored
      ? att.type.isSingleItem
        ? {
            __type: "put",
            type: att.type.storedName,
          }
        : {
            __type: "set",
            type: att.type.storedName,
          }
      : { __type: "none" };

    if (isStored) {
      this.code.line(
        `private ${att.storageName}${att.isOptional ? "?" : ""}: ${
          att.type.storedName
        };`
      );
    }

    switch (getterType._type) {
      case "plain":
        this.code.openBlock(`public get ${att.name}()`);
        this.code.line(`return ${this.determineGetAttCall(att)};`);
        this.code.closeBlock();
        break;

      case "args":
        this.code.openBlock(
          `public ${att.name}(${getterType.args})${
            getterType.returnType ? ": " + getterType.returnType : ""
          }`
        );
        this.code.line(`return ${getterType.returnStatement};`);
        this.code.closeBlock();
        break;

      case "stored_class":
        this.code.openBlock(`public get ${att.name}()`);
        this.code.line(`return ${this.storedClassAccess(att)};`);
        this.code.closeBlock();
        break;
    }

    if (setterType.__type === "set") {
      this.code.openBlock(`public set ${att.name}(value: ${setterType.type})`);
      this.code.line(`this.${att.storageName} = value;`);
      this.code.closeBlock();
    } else if (setterType.__type === "put") {
      this.code.openBlock(`public put${att.name}(value: ${setterType.type})`);
      this.code.line(`this.${att.storageName} = value;`);
      this.code.closeBlock();
    }

    if (hasResetMethod) {
      this.code.openBlock(
        `public ${this.getResetName(att.name, escapeReset)}()`
      );
      this.code.line(`this.${att.storageName} = undefined;`);
      this.code.closeBlock();
    }

    if (hasInputMethod) {
      this.code.line(`// Temporarily expose input value. Use with caution.`);
      this.code.openBlock(
        `public get ${this.getInputName(att, escapeInput)}()`
      );
      this.code.line(`return this.${att.storageName}`);
      this.code.closeBlock();
    }
  }

  private storedClassAccess(att: AttributeModel) {
    const invocation = `new ${att.type.name}(this as any, "${
      att.terraformName
    }"${
      (att.type.struct?.assignableAttributes.length || 0) > 0
        ? `, this.${att.storageName}`
        : ""
    })`;

    return att.isOptional
      ? `this.${att.storageName} ? ${invocation} : undefined`
      : invocation;
  }

  public determineGetAttCall(att: AttributeModel): string {
    if (att.isProvider) {
      return `this.${att.storageName}`;
    }

    const type = att.type;
    if (type.isString) {
      return `this.getStringAttribute('${att.terraformName}')`;
    }
    if (type.isStringList) {
      return `this.getListAttribute('${att.terraformName}')`;
    }
    if (type.isNumber) {
      return `this.getNumberAttribute('${att.terraformName}')`;
    }
    if (type.isBoolean) {
      return `this.getBooleanAttribute('${att.terraformName}') as any`;
    }
    if (process.env.DEBUG) {
      console.error(
        `The attribute ${JSON.stringify(att)} isn't implemented yet`
      );
    }
    return `this.interpolationForAttribute('${att.terraformName}') as any`;
  }

  public determineMapType(att: AttributeModel): string {
    const type = att.type;
    if (type.isStringMap) {
      return `string`;
    }
    if (type.isNumberMap) {
      return `number`;
    }
    if (type.isBooleanMap) {
      return `boolean`;
    }
    if (process.env.DEBUG) {
      console.error(
        `The attribute ${JSON.stringify(att)} isn't implemented yet`
      );
    }
    return `any`;
  }

  public needsInputEscape(
    att: AttributeModel,
    attributes: AttributeModel[]
  ): boolean {
    return (
      attributes.find((a) =>
        a.terraformName.match(`^${att.terraformName}_input$`)
      ) instanceof AttributeModel
    );
  }

  public getInputName(att: AttributeModel, escape: boolean) {
    if (escape) {
      return `${att.name}TfInput`;
    } else {
      return `${att.name}Input`;
    }
  }

  public needsResetEscape(
    att: AttributeModel,
    attributes: AttributeModel[]
  ): boolean {
    return (
      attributes.find((a) =>
        a.terraformName.match(`^reset_${att.terraformName}$`)
      ) instanceof AttributeModel
    );
  }

  public getResetName(name: string, escape: boolean) {
    if (!name) return name;
    if (escape) {
      return `resetTf${name[0].toUpperCase() + name.slice(1)}`;
    } else {
      return `reset${name[0].toUpperCase() + name.slice(1)}`;
    }
  }

  public emitToTerraform(att: AttributeModel, isStruct: boolean) {
    const type = att.type;
    const context = isStruct ? "struct!" : "this";
    const name = isStruct ? att.name : att.storageName;
    const customDefault = CUSTOM_DEFAULTS[att.terraformFullName];

    const varReference = `${context}.${name}`;
    const defaultCheck =
      customDefault !== undefined
        ? `${varReference} === undefined ? ${customDefault} : `
        : "";

    switch (true) {
      case type.isList && type.isMap:
        this.code.line(
          `${
            att.terraformName
          }: ${defaultCheck}cdktf.listMapper(cdktf.hashMapper(cdktf.${this.determineMapType(
            att
          )}ToTerraform))(${varReference}),`
        );
        break;
      case type.isStringList || type.isNumberList || type.isBooleanList:
        this.code.line(
          `${
            att.terraformName
          }: ${defaultCheck}cdktf.listMapper(cdktf.${downcaseFirst(
            type.innerType
          )}ToTerraform)(${varReference}),`
        );
        break;
      case type.isList && !type.isSingleItem:
        this.code.line(
          `${
            att.terraformName
          }: ${defaultCheck}cdktf.listMapper(${downcaseFirst(
            type.innerType
          )}ToTerraform)(${varReference}),`
        );
        break;
      case type.isMap:
        this.code.line(
          `${
            att.terraformName
          }: ${defaultCheck}cdktf.hashMapper(cdktf.${this.determineMapType(
            att
          )}ToTerraform)(${varReference}),`
        );
        break;
      case type.isString:
        this.code.line(
          `${att.terraformName}: ${defaultCheck}cdktf.stringToTerraform(${varReference}),`
        );
        break;
      case type.isNumber:
        this.code.line(
          `${att.terraformName}: ${defaultCheck}cdktf.numberToTerraform(${varReference}),`
        );
        break;
      case type.isBoolean:
        this.code.line(
          `${att.terraformName}: ${defaultCheck}cdktf.booleanToTerraform(${varReference}),`
        );
        break;
      default:
        this.code.line(
          `${att.terraformName}: ${defaultCheck}${downcaseFirst(
            type.name
          )}ToTerraform(${varReference}),`
        );
        break;
    }
  }
}

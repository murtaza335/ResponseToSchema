import * as vscode from 'vscode';
import { GenerateOptions, TypeStyle, ZodVersion } from './core/generate';

export const CONFIG_SECTION = 'responseToSchema';

export type OutputMode = 'combined' | 'zod' | 'typescript';

/** Options the panel lets the user tweak per session (initialised from settings). */
export interface PanelOptions {
  rootName: string;
  outputMode: OutputMode;
  style: TypeStyle;
  zodVersion: ZodVersion;
  includeFetcher: boolean;
}

export function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

export function defaultPanelOptions(): PanelOptions {
  const cfg = getConfig();
  return {
    rootName: '',
    outputMode: cfg.get<OutputMode>('outputMode', 'combined'),
    style: cfg.get<TypeStyle>('typeStyle', 'named'),
    zodVersion: cfg.get<ZodVersion>('zodVersion', '4'),
    includeFetcher: cfg.get<boolean>('includeFetcher', false),
  };
}

export function generateOptions(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  const cfg = getConfig();
  const indentSetting = cfg.get<string>('indentation', '2');
  return {
    rootName: 'Root',
    style: cfg.get<TypeStyle>('typeStyle', 'named'),
    zodVersion: cfg.get<ZodVersion>('zodVersion', '4'),
    indent: indentSetting === 'tab' ? '\t' : ' '.repeat(Number(indentSetting) || 2),
    detectFormats: cfg.get<boolean>('detectFormats', true),
    detectIntegers: cfg.get<boolean>('detectIntegers', false),
    arraySampleLimit: cfg.get<number>('arraySampleLimit', 1000),
    ...overrides,
  };
}

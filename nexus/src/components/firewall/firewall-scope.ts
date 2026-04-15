import { api } from '@/lib/proxmox-client';
import type {
  FirewallRulePublic,
  FirewallRuleParamsPublic,
  FirewallOptionsPublic,
} from '@/types/proxmox';

export type FirewallScope =
  | { kind: 'cluster' }
  | { kind: 'node'; node: string }
  | { kind: 'vm'; node: string; vmid: number }
  | { kind: 'ct'; node: string; vmid: number };

export function scopeLabel(s: FirewallScope): string {
  switch (s.kind) {
    case 'cluster': return 'Datacenter';
    case 'node': return `Node ${s.node}`;
    case 'vm': return `VM ${s.vmid}`;
    case 'ct': return `CT ${s.vmid}`;
  }
}

export function scopeKey(s: FirewallScope): string[] {
  switch (s.kind) {
    case 'cluster': return ['firewall', 'cluster'];
    case 'node': return ['firewall', 'node', s.node];
    case 'vm': return ['firewall', 'vm', s.node, String(s.vmid)];
    case 'ct': return ['firewall', 'ct', s.node, String(s.vmid)];
  }
}

export function listRules(s: FirewallScope): Promise<FirewallRulePublic[]> {
  switch (s.kind) {
    case 'cluster': return api.firewall.cluster.rules.list();
    case 'node': return api.firewall.node.rules.list(s.node);
    case 'vm': return api.firewall.vm.rules.list(s.node, s.vmid);
    case 'ct': return api.firewall.ct.rules.list(s.node, s.vmid);
  }
}

export function createRule(s: FirewallScope, params: FirewallRuleParamsPublic) {
  switch (s.kind) {
    case 'cluster': return api.firewall.cluster.rules.create(params);
    case 'node': return api.firewall.node.rules.create(s.node, params);
    case 'vm': return api.firewall.vm.rules.create(s.node, s.vmid, params);
    case 'ct': return api.firewall.ct.rules.create(s.node, s.vmid, params);
  }
}

export function updateRule(s: FirewallScope, pos: number, params: FirewallRuleParamsPublic) {
  switch (s.kind) {
    case 'cluster': return api.firewall.cluster.rules.update(pos, params);
    case 'node': return api.firewall.node.rules.update(s.node, pos, params);
    case 'vm': return api.firewall.vm.rules.update(s.node, s.vmid, pos, params);
    case 'ct': return api.firewall.ct.rules.update(s.node, s.vmid, pos, params);
  }
}

export function deleteRule(s: FirewallScope, pos: number, digest?: string) {
  switch (s.kind) {
    case 'cluster': return api.firewall.cluster.rules.delete(pos, digest);
    case 'node': return api.firewall.node.rules.delete(s.node, pos, digest);
    case 'vm': return api.firewall.vm.rules.delete(s.node, s.vmid, pos, digest);
    case 'ct': return api.firewall.ct.rules.delete(s.node, s.vmid, pos, digest);
  }
}

export function moveRule(s: FirewallScope, pos: number, moveto: number, digest?: string) {
  switch (s.kind) {
    case 'cluster': return api.firewall.cluster.rules.move(pos, moveto, digest);
    case 'node': return api.firewall.node.rules.move(s.node, pos, moveto, digest);
    case 'vm': return api.firewall.vm.rules.move(s.node, s.vmid, pos, moveto, digest);
    case 'ct': return api.firewall.ct.rules.move(s.node, s.vmid, pos, moveto, digest);
  }
}

export function getOptions(s: FirewallScope): Promise<FirewallOptionsPublic> {
  switch (s.kind) {
    case 'cluster': return api.firewall.cluster.options.get();
    case 'node': return api.firewall.node.options.get(s.node);
    case 'vm': return api.firewall.vm.options.get(s.node, s.vmid);
    case 'ct': return api.firewall.ct.options.get(s.node, s.vmid);
  }
}

export function updateOptions(s: FirewallScope, opts: Partial<FirewallOptionsPublic>) {
  switch (s.kind) {
    case 'cluster': return api.firewall.cluster.options.update(opts);
    case 'node': return api.firewall.node.options.update(s.node, opts);
    case 'vm': return api.firewall.vm.options.update(s.node, s.vmid, opts);
    case 'ct': return api.firewall.ct.options.update(s.node, s.vmid, opts);
  }
}

import { ObjectStrip } from "@/components/planner/objects/task-objects";
import { usePlanner } from "@/lib/planner-store";
import type { Asset } from "@/lib/planner-types";

/**
 * The same attach row as on tasks, for a card (no `parentId`), one of its log
 * entries or a «что болит» note (`parentId`): files, photos, links, contacts.
 */
export function AssetObjects({ asset, parentId, label }: { asset: Asset; parentId?: string; label?: string }) {
  const addLink = usePlanner((s) => s.addAssetLink);
  const removeLink = usePlanner((s) => s.removeAssetLink);
  const addContact = usePlanner((s) => s.addAssetContact);
  const removeContact = usePlanner((s) => s.removeAssetContact);
  const mine = <T extends { entryId?: string }>(list: T[] | undefined) => (list ?? []).filter((x) => (x.entryId ?? null) === (parentId ?? null));
  return (
    <ObjectStrip
      target={{ kind: "asset", id: asset.id, ...(parentId ? { entryId: parentId } : {}) }}
      files={mine(asset.attachments)}
      links={mine(asset.links)}
      contacts={mine(asset.contacts)}
      label={label}
      onAddLink={(href, title) => addLink(asset.id, parentId ?? null, href, title)}
      onRemoveLink={(id) => removeLink(asset.id, id)}
      onAddContact={(c) => addContact(asset.id, parentId ?? null, c)}
      onRemoveContact={(id) => removeContact(asset.id, id)}
    />
  );
}

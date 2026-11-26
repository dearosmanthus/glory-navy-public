import json
import pathlib
import re
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "eve-sde-latest-jsonl.zip"
OUTPUT = pathlib.Path(__file__).resolve().parents[1] / "public" / "industry-data.json"


def rows(package: zipfile.ZipFile, name: str):
    with package.open(name) as stream:
        for line in stream:
            yield json.loads(line)


def localized_name(row: dict, fallback: str):
    names = row.get("name", {})
    english = names.get("en", fallback)
    return names.get("zh", english), english


with zipfile.ZipFile(ARCHIVE) as package:
    types = {row["_key"]: row for row in rows(package, "types.jsonl")}
    groups = {row["_key"]: row for row in rows(package, "groups.jsonl")}
    categories = {row["_key"]: row for row in rows(package, "categories.jsonl")}
    type_dogma = {row["_key"]: row for row in rows(package, "typeDogma.jsonl")}
    sde = json.loads(package.read("_sde.jsonl"))["buildNumber"]

    recipes = []
    referenced_type_ids = set()
    referenced_group_ids = set()

    for blueprint in rows(package, "blueprints.jsonl"):
        for activity_name, activity_kind in (("manufacturing", 0), ("reaction", 1)):
            activity = blueprint.get("activities", {}).get(activity_name)
            if not activity:
                continue

            products = activity.get("products", [])
            if len(products) != 1:
                continue

            product = products[0]
            product_type = types.get(product.get("typeID"), {})
            if not product_type.get("published") or not product_type.get("name", {}).get("en"):
                continue

            materials = [
                [material["typeID"], material["quantity"]]
                for material in activity.get("materials", [])
                if material.get("quantity", 0) > 0
            ]
            skills = [
                [skill["typeID"], skill["level"]]
                for skill in activity.get("skills", [])
                if skill.get("level", 0) > 0
            ]
            if not materials:
                continue

            product_id = product["typeID"]
            group_id = product_type.get("groupID", 0)
            recipes.append([
                product_id,
                blueprint.get("blueprintTypeID", blueprint["_key"]),
                product.get("quantity", 1),
                activity.get("time", 0),
                activity_kind,
                group_id,
                materials,
                skills,
            ])
            referenced_type_ids.add(product_id)
            referenced_type_ids.update(material[0] for material in materials)
            referenced_type_ids.update(skill[0] for skill in skills)
            referenced_group_ids.add(group_id)

    compact_types = []
    for type_id in sorted(referenced_type_ids):
        item = types.get(type_id, {})
        zh, en = localized_name(item, f"Type {type_id}")
        group_id = item.get("groupID", 0)
        group = groups.get(group_id, {})
        category_id = group.get("categoryID", 0)
        compact_types.append([
            type_id,
            zh,
            en,
            item.get("packagedVolume", item.get("volume", 0)) or 0,
            group_id,
            category_id,
            item.get("metaGroupID", 0) or 0,
        ])
        referenced_group_ids.add(group_id)

    compact_groups = []
    for group_id in sorted(referenced_group_ids):
        group = groups.get(group_id, {})
        zh, en = localized_name(group, f"Group {group_id}")
        compact_groups.append([group_id, zh, en, group.get("categoryID", 0)])

    rig_name = re.compile(
        r"^Standup (M|L|XL)-Set .* Manufacturing (?:Material |Time )?Efficiency (?:I|II)$"
    )
    rig_sizes = {"M": 2, "L": 3, "XL": 4}
    compact_rigs = []
    for type_id, item in types.items():
        english = item.get("name", {}).get("en", "")
        match = rig_name.match(english)
        if not match or not item.get("published"):
            continue
        attributes = {
            entry["attributeID"]: entry.get("value", 0)
            for entry in type_dogma.get(type_id, {}).get("dogmaAttributes", [])
        }
        material = abs(float(attributes.get(2594, 0)))
        time = abs(float(attributes.get(2593, 0)))
        if material <= 0 and time <= 0:
            continue
        zh, en = localized_name(item, english)
        compact_rigs.append([
            type_id,
            zh,
            en,
            rig_sizes[match.group(1)],
            int(item.get("techLevel", 0) or 0),
            material,
            time,
        ])
    compact_rigs.sort(key=lambda rig: (rig[3], rig[1], rig[4]))

payload = {
    "schema": 3,
    "source": "CCP EVE Online Static Data Export",
    "sde": sde,
    "types": compact_types,
    "groups": compact_groups,
    "recipes": recipes,
    "rigs": compact_rigs,
}

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

reaction_count = sum(recipe[4] for recipe in recipes)
print(f"Wrote {len(recipes):,} recipes ({reaction_count:,} reactions) and {len(compact_types):,} types")
print(f"Included {len(compact_rigs):,} real manufacturing rigs")
print(f"SDE build: {sde}")
print(f"Size: {OUTPUT.stat().st_size / 1024 / 1024:.2f} MiB")

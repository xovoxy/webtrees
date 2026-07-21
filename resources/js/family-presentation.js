'use strict';

const dataNode = document.getElementById('family-presentation-data');

if (dataNode) {
  const data = JSON.parse(dataNode.textContent);
  const modes = ['constellation', 'timeline', 'overview'];
  const descriptions = {
    constellation: '多家族血脉通过婚姻汇流，点击人物查看直系亲属',
    timeline: '沿年代展开出生、婚姻与生命故事',
    overview: '从成员、家庭与年代读懂家族全貌',
  };
  let activeMode = 'constellation';
  let autoplay = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let autoplayTimer = null;
  let timelineScaleMode = 'narrative';

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const modeButtons = Array.from(document.querySelectorAll('[data-mode]'));
  const panels = Array.from(document.querySelectorAll('[data-panel]'));
  const progress = document.getElementById('family-screen-progress');
  const current = document.getElementById('family-screen-current');
  const description = document.getElementById('family-screen-mode-description');
  const autoplayButton = document.getElementById('family-screen-autoplay');
  const autoplayLabel = document.getElementById('family-screen-autoplay-label');

  const svgElement = (name, attributes = {}) => {
    const element = document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  };

  const plainYear = (node) => {
    if (node.birthYear && node.deathYear) return `${node.birthYear} — ${node.deathYear}`;
    if (node.birthYear) return `${node.birthYear} —`;
    if (node.deathYear) return `— ${node.deathYear}`;
    return '年代未详';
  };

  const shorten = (text, length = 8) => {
    const characters = Array.from(text || '未具名');
    return characters.length > length ? `${characters.slice(0, length).join('')}…` : characters.join('');
  };

  const clanName = (node) => {
    const surname = String(node?.surname || '').replace(/[\s,]+/g, '');
    return surname ? `${shorten(surname, 4)}氏` : '氏族未详';
  };

  const chineseNumber = (value) => {
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (!Number.isInteger(value) || value < 1) return String(value || '');
    if (value < 10) return digits[value];
    if (value === 10) return '十';
    if (value < 20) return `十${digits[value - 10]}`;
    if (value < 100) return `${digits[Math.floor(value / 10)]}十${value % 10 ? digits[value % 10] : ''}`;
    return String(value);
  };

  const familyRelationships = () => {
    const relationships = new Map(data.nodes.map((node) => [node.id, {
      parents: new Set(),
      spouses: new Set(),
      children: new Set(),
    }]));
    data.families.forEach((family) => {
      family.parents.forEach((parent) => {
        family.parents.forEach((spouse) => {
          if (parent !== spouse) relationships.get(parent)?.spouses.add(spouse);
        });
        family.children.forEach((child) => {
          relationships.get(parent)?.children.add(child);
          relationships.get(child)?.parents.add(parent);
        });
      });
    });
    return relationships;
  };

  const buildLineageModel = (relationships) => {
    const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
    const lineageByNode = new Map();
    const clans = new Map();

    data.nodes.forEach((node) => {
      const clan = clanName(node);
      if (!clans.has(clan)) clans.set(clan, []);
      clans.get(clan).push(node);
    });

    clans.forEach((members, clan) => {
      if (clan === '氏族未详') {
        members.forEach((node) => lineageByNode.set(node.id, { clan, generation: null, root: node.id }));
        return;
      }

      const memberIds = new Set(members.map((node) => node.id));
      const sameClanParents = new Map(members.map((node) => [
        node.id,
        [...(relationships.get(node.id)?.parents || [])].filter((parentId) => memberIds.has(parentId)),
      ]));
      const generations = new Map();
      const branchRoots = new Map();
      const indegrees = new Map(members.map((node) => [node.id, sameClanParents.get(node.id).length]));
      const queue = members
        .filter((node) => indegrees.get(node.id) === 0)
        .sort((left, right) => (left.birthYear || 9999) - (right.birthYear || 9999));

      queue.forEach((node) => {
        generations.set(node.id, 1);
        branchRoots.set(node.id, node.id);
      });

      while (queue.length > 0) {
        const current = queue.shift();
        [...(relationships.get(current.id)?.children || [])]
          .filter((childId) => memberIds.has(childId))
          .forEach((childId) => {
            const nextGeneration = (generations.get(current.id) || 1) + 1;
            if (nextGeneration > (generations.get(childId) || 0)) {
              generations.set(childId, nextGeneration);
              branchRoots.set(childId, branchRoots.get(current.id) || current.id);
            }
            indegrees.set(childId, Math.max(0, (indegrees.get(childId) || 0) - 1));
            if (indegrees.get(childId) === 0) queue.push(nodeById.get(childId));
          });
      }

      members.forEach((node) => lineageByNode.set(node.id, {
        clan,
        generation: generations.get(node.id) || 1,
        root: branchRoots.get(node.id) || node.id,
      }));
    });

    data.nodes.forEach((node) => {
      const lineage = lineageByNode.get(node.id);
      if (!lineage) return;
      const memberships = new Map();
      if (lineage.generation) memberships.set(lineage.clan, lineage.generation);
      [...(relationships.get(node.id)?.parents || [])].forEach((parentId) => {
        const parentLineage = lineageByNode.get(parentId);
        if (!parentLineage?.generation || parentLineage.clan === '氏族未详') return;
        memberships.set(
          parentLineage.clan,
          Math.max(memberships.get(parentLineage.clan) || 0, parentLineage.generation + 1),
        );
      });
      lineage.memberships = [...memberships].map(([clan, generation]) => ({ clan, generation }));
    });

    return lineageByNode;
  };

  const lineageLabel = (node, lineageByNode) => {
    const lineage = lineageByNode.get(node.id);
    if (!lineage || !lineage.generation) return clanName(node);
    return `${lineage.clan} · ${chineseNumber(lineage.generation)}世`;
  };

  const lineageDetailLabel = (node, lineageByNode) => {
    const memberships = lineageByNode.get(node.id)?.memberships || [];
    if (memberships.length === 0) return lineageLabel(node, lineageByNode);
    return memberships
      .slice(0, 3)
      .map(({ clan, generation }) => `${clan}${chineseNumber(generation)}世`)
      .join(' · ');
  };

  const relationshipLayerLabel = (difference) => {
    if (difference === 0) return '同辈 · 联姻层';
    if (difference === -1) return '父母辈';
    if (difference === -2) return '祖父母辈';
    if (difference === -3) return '曾祖辈';
    if (difference === 1) return '子女辈';
    if (difference === 2) return '孙辈';
    if (difference === 3) return '曾孙辈';
    return difference < 0 ? `上溯 ${Math.abs(difference)} 代` : `下延 ${difference} 代`;
  };

  const pedigreeLayout = () => {
    const cardWidth = 174;
    const cardHeight = 76;
    const memberGap = 16;
    const unitGap = 64;
    const rowGap = 190;
    const parent = new Map(data.nodes.map((node) => [node.id, node.id]));

    const find = (id) => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root);
      let currentId = id;
      while (parent.get(currentId) !== root) {
        const nextId = parent.get(currentId);
        parent.set(currentId, root);
        currentId = nextId;
      }
      return root;
    };

    const union = (left, right) => {
      if (!parent.has(left) || !parent.has(right)) return;
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
    };

    data.families.forEach((family) => {
      family.parents.slice(1).forEach((person) => union(family.parents[0], person));
    });

    const units = new Map();
    const nodeUnit = new Map();
    data.nodes.forEach((node) => {
      const unitId = find(node.id);
      if (!units.has(unitId)) units.set(unitId, { id: unitId, members: [], children: new Set(), parents: new Set() });
      units.get(unitId).members.push(node);
      nodeUnit.set(node.id, unitId);
    });

    data.families.forEach((family) => {
      const parentUnit = family.parents.map((id) => nodeUnit.get(id)).find(Boolean);
      if (!parentUnit) return;
      family.children.forEach((child) => {
        const childUnit = nodeUnit.get(child);
        if (childUnit && childUnit !== parentUnit) {
          units.get(parentUnit).children.add(childUnit);
          units.get(childUnit).parents.add(parentUnit);
        }
      });
    });

    // The canvas rank is relationship-based, not a clan's native generation number.
    // Walking outwards from an anchor keeps every parent exactly one layer above a child,
    // while the spouse union lets lineages with different recorded depths meet on one row.
    const unitRanks = new Map();
    const anchorUnitId = nodeUnit.get(data.tree.root) || units.keys().next().value;
    const anchorBirthYear = units.get(anchorUnitId)?.members
      .map((member) => member.birthYear)
      .filter(Number.isFinite)[0] || null;
    const walkComponent = (startId, startRank) => {
      const queue = [startId];
      unitRanks.set(startId, startRank);
      while (queue.length > 0) {
        const unitId = queue.shift();
        const unit = units.get(unitId);
        const rank = unitRanks.get(unitId);
        const neighbours = [
          ...[...unit.parents].map((id) => ({ id, rank: rank - 1 })),
          ...[...unit.children].map((id) => ({ id, rank: rank + 1 })),
        ];
        neighbours.forEach((neighbour) => {
          if (unitRanks.has(neighbour.id)) return;
          unitRanks.set(neighbour.id, neighbour.rank);
          queue.push(neighbour.id);
        });
      }
    };

    walkComponent(anchorUnitId, 0);
    [...units.values()]
      .filter((unit) => !unitRanks.has(unit.id))
      .sort((left, right) => (left.members[0]?.birthYear || 9999) - (right.members[0]?.birthYear || 9999))
      .forEach((unit) => {
        if (unitRanks.has(unit.id)) return;
        const unitBirthYear = unit.members.map((member) => member.birthYear).filter(Number.isFinite)[0] || null;
        const estimatedRank = anchorBirthYear && unitBirthYear
          ? Math.round((unitBirthYear - anchorBirthYear) / 28)
          : 0;
        walkComponent(unit.id, estimatedRank);
      });

    const minimumRank = Math.min(0, ...unitRanks.values());
    const unitLevels = new Map([...unitRanks].map(([unitId, rank]) => [unitId, rank - minimumRank]));

    units.forEach((unit) => {
      if (!unitLevels.has(unit.id)) unitLevels.set(unit.id, 0);
      unit.members.sort((left, right) => {
        if (left.isRoot) return -1;
        if (right.isRoot) return 1;
        return (left.birthYear || 9999) - (right.birthYear || 9999);
      });
    });

    const rows = new Map();
    units.forEach((unit) => {
      const level = unitLevels.get(unit.id);
      if (!rows.has(level)) rows.set(level, []);
      rows.get(level).push(unit);
    });

    const unitPositions = new Map();
    const nodePositions = new Map();
    const sortedLevels = [...rows.keys()].sort((left, right) => left - right);
    const familyGroupGap = unitGap + 42;
    const unitWidth = (unit) => unit.members.length * cardWidth + Math.max(0, unit.members.length - 1) * memberGap;
    const unitBirthYear = (unit) => Math.min(...unit.members.map((member) => member.birthYear || 9999));
    const levelPositions = new Map();
    const placeUnit = (unit, left, level) => {
      const width = unitWidth(unit);
      const y = 135 + level * rowGap;
      levelPositions.set(level, y);
      unitPositions.set(unit.id, { x: left + width / 2, y, width, level });
      unit.members.forEach((node, memberIndex) => {
        nodePositions.set(node.id, {
          x: left + cardWidth / 2 + memberIndex * (cardWidth + memberGap),
          y,
        });
      });
    };

    sortedLevels.forEach((level) => {
      const row = rows.get(level);
      if (level === sortedLevels[0]) {
        row.sort((left, right) => unitBirthYear(left) - unitBirthYear(right));
        let cursor = 0;
        row.forEach((unit) => {
          placeUnit(unit, cursor, level);
          cursor += unitWidth(unit) + familyGroupGap;
        });
        return;
      }

      const groupsByParents = new Map();
      row.forEach((unit) => {
        const positionedParents = [...unit.parents]
          .filter((parentId) => unitPositions.has(parentId))
          .sort((left, right) => unitPositions.get(left).x - unitPositions.get(right).x);
        const key = positionedParents.length > 0 ? positionedParents.join('|') : `orphan:${unit.id}`;
        if (!groupsByParents.has(key)) {
          const preferredCenter = positionedParents.length > 0
            ? positionedParents.reduce((sum, parentId) => sum + unitPositions.get(parentId).x, 0) / positionedParents.length
            : Number.POSITIVE_INFINITY;
          groupsByParents.set(key, { preferredCenter, units: [] });
        }
        groupsByParents.get(key).units.push(unit);
      });

      const familyGroupsInRow = [...groupsByParents.values()];
      familyGroupsInRow.forEach((group) => {
        group.units.sort((left, right) => unitBirthYear(left) - unitBirthYear(right));
        group.width = group.units.reduce((sum, unit) => sum + unitWidth(unit), 0)
          + Math.max(0, group.units.length - 1) * unitGap;
      });
      familyGroupsInRow.sort((left, right) => {
        if (left.preferredCenter !== right.preferredCenter) return left.preferredCenter - right.preferredCenter;
        return unitBirthYear(left.units[0]) - unitBirthYear(right.units[0]);
      });

      let groupCursor = Number.NEGATIVE_INFINITY;
      familyGroupsInRow.forEach((group, index) => {
        const idealLeft = Number.isFinite(group.preferredCenter)
          ? group.preferredCenter - group.width / 2
          : (Number.isFinite(groupCursor) ? groupCursor : index * familyGroupGap);
        group.left = Number.isFinite(groupCursor) ? Math.max(idealLeft, groupCursor) : idealLeft;
        groupCursor = group.left + group.width + familyGroupGap;
      });

      const anchoredGroups = familyGroupsInRow.filter((group) => Number.isFinite(group.preferredCenter));
      if (anchoredGroups.length > 0) {
        const centeringOffset = anchoredGroups.reduce((sum, group) => (
          sum + group.preferredCenter - (group.left + group.width / 2)
        ), 0) / anchoredGroups.length;
        familyGroupsInRow.forEach((group) => { group.left += centeringOffset; });
      }

      familyGroupsInRow.forEach((group) => {
        let unitCursor = group.left;
        group.units.forEach((unit) => {
          placeUnit(unit, unitCursor, level);
          unitCursor += unitWidth(unit) + unitGap;
        });
      });
    });

    const orderedRows = new Map(sortedLevels.map((level) => [
      level,
      [...rows.get(level)].sort((left, right) => unitPositions.get(left.id).x - unitPositions.get(right.id).x),
    ]));
    const lineageKey = (unit) => [...unit.parents].sort().join('|');
    const rowGapBetween = (left, right) => {
      const leftLineage = lineageKey(left);
      const rightLineage = lineageKey(right);
      return leftLineage && leftLineage === rightLineage ? unitGap : familyGroupGap;
    };
    const relaxRow = (level, relationKey, strength) => {
      const row = orderedRows.get(level);
      const targets = new Map();
      row.forEach((unit) => {
        const relatedPositions = [...unit[relationKey]]
          .map((relatedId) => unitPositions.get(relatedId)?.x)
          .filter(Number.isFinite);
        if (relatedPositions.length === 0) return;
        const target = relatedPositions.reduce((sum, x) => sum + x, 0) / relatedPositions.length;
        targets.set(unit.id, target);
        const position = unitPositions.get(unit.id);
        position.x += (target - position.x) * strength;
      });

      for (let index = 1; index < row.length; index += 1) {
        const previous = row[index - 1];
        const current = row[index];
        const previousPosition = unitPositions.get(previous.id);
        const currentPosition = unitPositions.get(current.id);
        const minimumCenter = previousPosition.x + previousPosition.width / 2
          + rowGapBetween(previous, current) + currentPosition.width / 2;
        if (currentPosition.x < minimumCenter) currentPosition.x = minimumCenter;
      }

      if (targets.size > 0) {
        const centeringOffset = [...targets.entries()].reduce((sum, [unitId, target]) => (
          sum + target - unitPositions.get(unitId).x
        ), 0) / targets.size;
        row.forEach((unit) => { unitPositions.get(unit.id).x += centeringOffset; });
      }
    };

    for (let pass = 0; pass < 8; pass += 1) {
      sortedLevels.slice(1).forEach((level) => relaxRow(level, 'parents', .62));
      sortedLevels.slice(0, -1).reverse().forEach((level) => relaxRow(level, 'children', .38));
    }

    nodePositions.clear();
    units.forEach((unit) => {
      const position = unitPositions.get(unit.id);
      const left = position.x - position.width / 2;
      unit.members.forEach((node, memberIndex) => {
        nodePositions.set(node.id, {
          x: left + cardWidth / 2 + memberIndex * (cardWidth + memberGap),
          y: position.y,
        });
      });
    });

    const positionedUnits = [...unitPositions.values()];
    const minLeft = Math.min(...positionedUnits.map((position) => position.x - position.width / 2));
    const maxRight = Math.max(...positionedUnits.map((position) => position.x + position.width / 2));
    const horizontalPadding = 110;
    const horizontalShift = horizontalPadding - minLeft;
    unitPositions.forEach((position) => { position.x += horizontalShift; });
    nodePositions.forEach((position) => { position.x += horizontalShift; });
    const contentWidth = maxRight - minLeft + horizontalPadding * 2;

    return {
      anchorLevel: unitLevels.get(anchorUnitId) || 0,
      cardHeight,
      cardWidth,
      contentHeight: 225 + Math.max(0, ...sortedLevels) * rowGap,
      contentWidth,
      levelPositions,
      nodeLevels: new Map(data.nodes.map((node) => [node.id, unitLevels.get(nodeUnit.get(node.id)) || 0])),
      nodePositions,
      nodeRanks: new Map(data.nodes.map((node) => [node.id, unitRanks.get(nodeUnit.get(node.id)) || 0])),
      rows,
      sortedLevels,
      unitPositions,
    };
  };

  const renderConstellation = () => {
    const svg = document.getElementById('constellation-map');
    if (!svg || data.nodes.length === 0) return;
    const relationships = familyRelationships();
    const lineageByNode = buildLineageModel(relationships);
    const layout = pedigreeLayout();
    const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
    const nodeGroups = new Map();
    const focusLabels = new Map();
    const familyGroups = new Map();
    const familyGeometry = new Map();
    const guideGroups = new Map();
    const tooltip = document.getElementById('pedigree-tooltip');
    const focusPanel = document.getElementById('pedigree-focus');
    const scaleReference = document.getElementById('pedigree-scale-reference');
    let focusedId = null;

    const defs = svgElement('defs');
    const gradient = svgElement('linearGradient', { id: 'constellation-edge-gradient', x1: '0%', x2: '0%', y1: '0%', y2: '100%' });
    gradient.append(svgElement('stop', { offset: '0%', 'stop-color': '#9bd7c9', 'stop-opacity': '.88' }));
    gradient.append(svgElement('stop', { offset: '100%', 'stop-color': '#69b9a9', 'stop-opacity': '.62' }));
    const filter = svgElement('filter', { id: 'constellation-glow', x: '-80%', y: '-80%', width: '260%', height: '260%' });
    filter.append(svgElement('feGaussianBlur', { stdDeviation: '2', result: 'blur' }));
    const merge = svgElement('feMerge');
    merge.append(svgElement('feMergeNode', { in: 'blur' }));
    merge.append(svgElement('feMergeNode', { in: 'SourceGraphic' }));
    filter.append(merge);
    defs.append(gradient, filter);
    svg.append(defs);

    const viewport = svgElement('g', { class: 'pedigree__viewport' });
    const guideLayer = svgElement('g', { class: 'pedigree__guides' });
    layout.sortedLevels.forEach((level) => {
      const y = layout.levelPositions.get(level) - 58;
      const guide = svgElement('g', { class: 'pedigree__guide', 'data-level': String(level) });
      const label = svgElement('text', { class: 'pedigree__generation-label', x: '32', y: String(y) });
      const caption = svgElement('text', { class: 'pedigree__generation-caption', x: '32', y: String(y + 17) });
      const line = svgElement('line', {
        class: 'pedigree__generation-line',
        x1: '156', y1: String(y - 4), x2: String(layout.contentWidth - 30), y2: String(y - 4),
      });
      guide.append(label, caption, line);
      guideLayer.append(guide);
      guideGroups.set(level, { caption, guide, label });
    });
    viewport.append(guideLayer);

    const updateGuideLabels = (referenceId) => {
      const reference = nodeById.get(referenceId) || nodeById.get(data.tree.root) || data.nodes[0];
      const referenceLevel = layout.nodeLevels.get(reference?.id) ?? layout.anchorLevel;
      guideGroups.forEach(({ caption, guide, label }, level) => {
        const difference = level - referenceLevel;
        label.textContent = relationshipLayerLabel(difference);
        caption.textContent = difference === 0 ? 'RELATION ORIGIN' : `RELATION ${difference > 0 ? '+' : ''}${difference}`;
        guide.classList.toggle('is-reference-layer', difference === 0);
      });
      if (scaleReference && reference) scaleReference.textContent = `以 ${reference.name} 为关系基准`;
    };

    updateGuideLabels(data.tree.root);

    const edgeLayer = svgElement('g', { class: 'pedigree__connections' });
    const appendBloodline = (group, d, type) => {
      group.append(svgElement('path', {
        class: `pedigree__bloodline-halo ${type}__halo`,
        d,
        pathLength: '100',
      }));
      group.append(svgElement('path', {
        class: `constellation__edge ${type}`,
        d,
        pathLength: '100',
      }));
    };
    data.families.forEach((family, familyIndex) => {
      const parentPositions = family.parents
        .map((id) => ({ id, ...layout.nodePositions.get(id) }))
        .filter((position) => Number.isFinite(position.x))
        .sort((left, right) => left.x - right.x);
      const childPositions = family.children
        .map((id) => ({ id, ...layout.nodePositions.get(id) }))
        .filter((position) => Number.isFinite(position.x));
      if (parentPositions.length === 0 && childPositions.length === 0) return;

      const familyGroup = svgElement('g', {
        class: 'pedigree__family',
        'data-family-id': family.id,
        'data-parents': family.parents.join(','),
        'data-children': family.children.join(','),
        style: `--family-delay:${Math.min(familyIndex * 85, 680)}ms`,
      });
      familyGroups.set(family.id, { family, group: familyGroup });

      const unionX = parentPositions.length > 0
        ? parentPositions.reduce((sum, position) => sum + position.x, 0) / parentPositions.length
        : childPositions.reduce((sum, position) => sum + position.x, 0) / childPositions.length;
      const unionY = parentPositions.length > 0 ? Math.max(...parentPositions.map((position) => position.y)) : childPositions[0].y - 150;
      const geometry = {
        busY: null,
        childY: null,
        childPositions,
        parentPositions,
        parentStartY: null,
        unionX,
        unionY,
      };
      familyGeometry.set(family.id, geometry);

      if (parentPositions.length > 1) {
        const left = parentPositions[0];
        const right = parentPositions[parentPositions.length - 1];
        familyGroup.append(svgElement('path', {
          class: 'pedigree__couple-line',
          d: `M ${left.x + layout.cardWidth / 2} ${left.y} H ${right.x - layout.cardWidth / 2}`,
          pathLength: '100',
        }));
      }

      if (parentPositions.length > 0) {
        familyGroup.append(svgElement('rect', {
          class: 'pedigree__marriage-mark',
          x: String(unionX - 4), y: String(unionY - 4), width: '8', height: '8', rx: '1',
          transform: `rotate(45 ${unionX} ${unionY})`,
        }));
      }

      if (parentPositions.length > 0 && childPositions.length > 0) {
        const parentStartY = parentPositions.length > 1 ? unionY : unionY + layout.cardHeight / 2;
        const childY = Math.min(...childPositions.map((position) => position.y)) - layout.cardHeight / 2;
        const busY = parentStartY + (childY - parentStartY) * .56;
        geometry.parentStartY = parentStartY;
        geometry.childY = childY;
        geometry.busY = busY;
        const childMinX = Math.min(...childPositions.map((position) => position.x));
        const childMaxX = Math.max(...childPositions.map((position) => position.x));
        appendBloodline(familyGroup, `M ${unionX} ${parentStartY} V ${busY}`, 'pedigree__descent-line');
        appendBloodline(
          familyGroup,
          `M ${Math.min(unionX, childMinX)} ${busY} H ${Math.max(unionX, childMaxX)}`,
          'pedigree__sibling-line',
        );
        childPositions.forEach((child) => {
          appendBloodline(familyGroup, `M ${child.x} ${busY} V ${childY - 5}`, 'pedigree__child-line');
          familyGroup.append(svgElement('circle', {
            class: 'pedigree__child-endpoint',
            cx: String(child.x), cy: String(childY - 5), r: '3.2',
          }));
        });

        const familyClans = [...new Set(family.parents.map((id) => clanName(nodeById.get(id))))];
        const familyCaption = `${familyClans.join(' × ') || '家庭来源未详'} · ${childPositions.length} 位子女`;
        const captionWidth = Math.min(190, Math.max(104, Array.from(familyCaption).length * 10 + 22));
        const captionY = busY - 15;
        familyGroup.append(svgElement('rect', {
          class: 'pedigree__union-badge',
          x: String(unionX - captionWidth / 2), y: String(captionY - 10),
          width: String(captionWidth), height: '20', rx: '10',
        }));
        const caption = svgElement('text', {
          class: 'pedigree__union-label', x: String(unionX), y: String(captionY + 3),
        });
        caption.textContent = familyCaption;
        familyGroup.append(caption);
      }
      edgeLayer.append(familyGroup);
    });
    const focusRayLayer = svgElement('g', { class: 'pedigree__focus-rays', 'aria-hidden': 'true' });
    viewport.append(edgeLayer, focusRayLayer);

    const showTooltip = (node, clientX, clientY) => {
      if (!tooltip) return;
      const relation = relationships.get(node.id);
      const relationParts = [];
      if (relation?.parents.size) relationParts.push(`父母 ${relation.parents.size}`);
      if (relation?.spouses.size) relationParts.push(`伴侣 ${relation.spouses.size}`);
      if (relation?.children.size) relationParts.push(`子女 ${relation.children.size}`);
      document.getElementById('pedigree-tooltip-initial').textContent = Array.from(node.name || '族')[0];
      document.getElementById('pedigree-tooltip-name').textContent = node.name;
      document.getElementById('pedigree-tooltip-lineage').textContent = `家族世代 · ${lineageDetailLabel(node, lineageByNode)}`;
      document.getElementById('pedigree-tooltip-life').textContent = `${plainYear(node)} · ${node.living ? '在世' : '已故'}`;
      document.getElementById('pedigree-tooltip-place').textContent = node.birthPlace ? `出生地 · ${node.birthPlace}` : '出生地暂未记录';
      document.getElementById('pedigree-tooltip-relations').textContent = relationParts.join(' · ') || '家庭关系暂未记录';
      const canvasRect = svg.parentElement.getBoundingClientRect();
      const tooltipWidth = 250;
      const tooltipHeight = 156;
      const left = Math.min(Math.max(12, clientX - canvasRect.left + 18), canvasRect.width - tooltipWidth - 12);
      const top = Math.min(Math.max(92, clientY - canvasRect.top + 18), canvasRect.height - tooltipHeight - 12);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.classList.add('is-visible');
    };

    const nodeLayer = svgElement('g', { class: 'constellation__nodes' });
    data.nodes.forEach((node, index) => {
      const position = layout.nodePositions.get(node.id);
      if (!position) return;
      const root = node.isRoot;
      const nodeLineage = lineageByNode.get(node.id);
      const nodeLineageLabel = lineageLabel(node, lineageByNode);
      const group = svgElement('g', {
        class: `constellation__node constellation__node--${node.sex === 'F' ? 'female' : 'male'}${root ? ' constellation__node--root' : ''}`,
        transform: `translate(${position.x} ${position.y})`,
        style: `animation-delay:${Math.min(index * 35, 600)}ms`,
        tabindex: '0',
        role: 'button',
        'aria-pressed': 'false',
        'aria-label': `${node.name}，${nodeLineageLabel}，${plainYear(node)}，点击聚焦直系亲属`,
        'data-lineage-root': nodeLineage?.root || node.id,
        'data-node-id': node.id,
      });
      group.append(svgElement('rect', {
        class: 'constellation__node-card',
        x: String(-layout.cardWidth / 2), y: String(-layout.cardHeight / 2),
        width: String(layout.cardWidth), height: String(layout.cardHeight), rx: '5',
      }));
      group.append(svgElement('line', {
        class: 'constellation__node-accent',
        x1: String(-layout.cardWidth / 2), y1: String(-layout.cardHeight / 2 + 10),
        x2: String(-layout.cardWidth / 2), y2: String(layout.cardHeight / 2 - 10),
      }));
      group.append(svgElement('circle', { class: 'constellation__node-core', cx: '-58', cy: '0', r: root ? '22' : '18' }));
      const initial = svgElement('text', { class: 'constellation__node-initial', x: '-58', y: '5' });
      initial.textContent = Array.from(node.name || '族')[0];
      const name = svgElement('text', { class: 'constellation__node-name', x: '-31', y: '-9' });
      name.textContent = shorten(node.name, 10);
      const years = svgElement('text', { class: 'constellation__node-years', x: '-31', y: '13' });
      years.textContent = plainYear(node);
      const lineageChip = svgElement('rect', { class: 'constellation__lineage-chip', x: '9', y: '17', width: '72', height: '17', rx: '8.5' });
      const clan = svgElement('text', { class: 'constellation__clan-label', x: '76', y: '29' });
      clan.textContent = nodeLineageLabel;
      const focusLabel = svgElement('text', { class: 'constellation__focus-label', x: '76', y: '-26' });
      focusLabel.textContent = root ? '画布基准' : '';
      group.append(initial, name, years, lineageChip, clan, focusLabel);
      nodeLayer.append(group);
      nodeGroups.set(node.id, group);
      focusLabels.set(node.id, focusLabel);

      group.addEventListener('pointerenter', (event) => showTooltip(node, event.clientX, event.clientY));
      group.addEventListener('pointermove', (event) => showTooltip(node, event.clientX, event.clientY));
      group.addEventListener('pointerleave', () => tooltip?.classList.remove('is-visible'));
      group.addEventListener('focus', () => {
        const rect = group.getBoundingClientRect();
        showTooltip(node, rect.right, rect.top + rect.height / 2);
      });
      group.addEventListener('blur', () => tooltip?.classList.remove('is-visible'));
    });
    viewport.append(nodeLayer);
    svg.append(viewport);

    const relationNames = (ids) => [...ids].map((id) => nodeById.get(id)?.name).filter(Boolean).join('、') || '无记录';
    const siblingRole = (reference, sibling) => {
      const referenceMin = reference?.birthMin;
      const referenceMax = reference?.birthMax;
      const siblingMin = sibling?.birthMin;
      const siblingMax = sibling?.birthMax;
      const isOlder = Number.isFinite(siblingMax) && Number.isFinite(referenceMin) && siblingMax < referenceMin;
      const isYounger = Number.isFinite(siblingMin) && Number.isFinite(referenceMax) && siblingMin > referenceMax;

      if (sibling?.sex === 'M') return isOlder ? '哥哥' : isYounger ? '弟弟' : '兄弟';
      if (sibling?.sex === 'F') return isOlder ? '姐姐' : isYounger ? '妹妹' : '姐妹';
      return isOlder ? '年长同胞' : isYounger ? '年幼同胞' : '同胞';
    };
    const siblingDescriptions = (reference, ids) => [...ids]
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .sort((left, right) => {
        const leftBirth = Number.isFinite(left.birthMin) ? left.birthMin : Number.POSITIVE_INFINITY;
        const rightBirth = Number.isFinite(right.birthMin) ? right.birthMin : Number.POSITIVE_INFINITY;
        return leftBirth - rightBirth;
      })
      .map((sibling) => `${siblingRole(reference, sibling)} · ${sibling.name}`)
      .join('、') || '无记录';
    const updateFocusPanel = (node, relation, siblings) => {
      if (!focusPanel) return;
      focusPanel.hidden = false;
      document.getElementById('pedigree-focus-name').textContent = node.name;
      document.getElementById('pedigree-focus-clan').textContent = `${lineageLabel(node, lineageByNode)} · 当前关系原点`;
      document.getElementById('pedigree-focus-parents').textContent = relationNames(relation.parents);
      document.getElementById('pedigree-focus-spouses').textContent = relationNames(relation.spouses);
      document.getElementById('pedigree-focus-children').textContent = relationNames(relation.children);
      document.getElementById('pedigree-focus-siblings').textContent = siblingDescriptions(node, siblings);
    };

    const renderFocusRays = (id) => {
      focusRayLayer.replaceChildren();
      const selected = layout.nodePositions.get(id);
      if (!selected) return;
      const appendRay = (d, targetId, relation) => {
        focusRayLayer.append(svgElement('path', {
          class: `pedigree__focus-ray pedigree__focus-ray--${relation}`,
          d,
          pathLength: '100',
          'data-focus-source': id,
          'data-focus-target': targetId,
        }));
      };

      data.families.forEach((family) => {
        const geometry = familyGeometry.get(family.id);
        if (!geometry) return;
        const { busY, childPositions, parentPositions, unionX, unionY } = geometry;

        if (family.children.includes(id) && Number.isFinite(busY)) {
          const startY = selected.y - layout.cardHeight / 2;
          childPositions.filter((child) => child.id !== id).forEach((sibling) => {
            appendRay(
              `M ${selected.x} ${startY} V ${busY} H ${sibling.x} V ${sibling.y - layout.cardHeight / 2}`,
              sibling.id,
              'sibling',
            );
          });
          parentPositions.forEach((parent) => {
            if (parentPositions.length > 1) {
              const endX = parent.x < unionX ? parent.x + layout.cardWidth / 2 : parent.x - layout.cardWidth / 2;
              appendRay(
                `M ${selected.x} ${startY} V ${busY} H ${unionX} V ${unionY} H ${endX}`,
                parent.id,
                'parent',
              );
            } else {
              appendRay(
                `M ${selected.x} ${startY} V ${busY} H ${parent.x} V ${parent.y + layout.cardHeight / 2}`,
                parent.id,
                'parent',
              );
            }
          });
        }

        if (!family.parents.includes(id)) return;
        const selectedParent = parentPositions.find((parent) => parent.id === id);
        if (!selectedParent) return;
        parentPositions.filter((parent) => parent.id !== id).forEach((spouse) => {
          const direction = spouse.x > selected.x ? 1 : -1;
          appendRay(
            `M ${selected.x + direction * layout.cardWidth / 2} ${selected.y} H ${spouse.x - direction * layout.cardWidth / 2}`,
            spouse.id,
            'spouse',
          );
        });

        if (!Number.isFinite(busY)) return;
        childPositions.forEach((child) => {
          if (parentPositions.length > 1) {
            const direction = unionX > selected.x ? 1 : -1;
            appendRay(
              `M ${selected.x + direction * layout.cardWidth / 2} ${selected.y} H ${unionX} V ${busY} H ${child.x} V ${child.y - layout.cardHeight / 2}`,
              child.id,
              'child',
            );
          } else {
            appendRay(
              `M ${selected.x} ${selected.y + layout.cardHeight / 2} V ${busY} H ${child.x} V ${child.y - layout.cardHeight / 2}`,
              child.id,
              'child',
            );
          }
        });
      });
    };

    const clearFocus = () => {
      focusedId = null;
      svg.classList.remove('is-family-focused');
      focusRayLayer.replaceChildren();
      nodeGroups.forEach((group, id) => {
        group.classList.remove('is-selected-person', 'is-direct-relative', 'is-collateral-relative', 'is-dimmed');
        group.setAttribute('aria-pressed', 'false');
        focusLabels.get(id).textContent = nodeById.get(id)?.isRoot ? '画布基准' : '';
      });
      familyGroups.forEach(({ group }) => group.classList.remove('is-active-family', 'is-dimmed-family'));
      if (focusPanel) focusPanel.hidden = true;
      updateGuideLabels(data.tree.root);
    };

    const focusPerson = (id) => {
      if (focusedId === id) {
        clearFocus();
        return;
      }
      const node = nodeById.get(id);
      const relation = relationships.get(id);
      if (!node || !relation) return;
      focusedId = id;
      svg.classList.add('is-family-focused');
      const direct = new Set([...relation.parents, ...relation.spouses, ...relation.children]);
      const siblings = new Set();
      data.families.forEach((family) => {
        if (!family.children.includes(id)) return;
        family.children.forEach((childId) => {
          if (childId !== id) siblings.add(childId);
        });
      });

      nodeGroups.forEach((group, nodeId) => {
        const isSelected = nodeId === id;
        const isDirect = direct.has(nodeId);
        const isSibling = siblings.has(nodeId);
        group.classList.toggle('is-selected-person', isSelected);
        group.classList.toggle('is-direct-relative', isDirect);
        group.classList.toggle('is-collateral-relative', isSibling);
        group.classList.toggle('is-dimmed', !isSelected && !isDirect && !isSibling);
        group.setAttribute('aria-pressed', String(isSelected));
        let role = '';
        if (isSelected) role = '当前人物';
        else if (relation.parents.has(nodeId)) role = nodeById.get(nodeId)?.sex === 'M' ? '父亲' : nodeById.get(nodeId)?.sex === 'F' ? '母亲' : '父母';
        else if (relation.spouses.has(nodeId)) role = '伴侣';
        else if (relation.children.has(nodeId)) role = nodeById.get(nodeId)?.sex === 'M' ? '儿子' : nodeById.get(nodeId)?.sex === 'F' ? '女儿' : '子女';
        else if (isSibling) role = siblingRole(node, nodeById.get(nodeId));
        focusLabels.get(nodeId).textContent = role;
      });

      familyGroups.forEach(({ family, group }) => {
        const active = family.parents.includes(id) || family.children.includes(id);
        group.classList.toggle('is-active-family', active);
        group.classList.toggle('is-dimmed-family', !active);
      });
      updateGuideLabels(id);
      renderFocusRays(id);
      updateFocusPanel(node, relation, siblings);
      tooltip?.classList.remove('is-visible');
    };

    nodeGroups.forEach((group, id) => {
      group.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (autoplay) toggleAutoplay();
        focusPerson(id);
      });
    });
    document.getElementById('pedigree-focus-clear')?.addEventListener('click', clearFocus);

    const viewState = { x: 0, y: 0, scale: 1 };
    let dragState = null;
    const applyView = () => viewport.setAttribute('transform', `translate(${viewState.x} ${viewState.y}) scale(${viewState.scale})`);
    const fitView = () => {
      const available = { x: 75, y: 105, width: 1450, height: 675 };
      viewState.scale = Math.min(1.2, available.width / layout.contentWidth, available.height / layout.contentHeight);
      viewState.x = available.x + (available.width - layout.contentWidth * viewState.scale) / 2;
      viewState.y = available.y + (available.height - layout.contentHeight * viewState.scale) / 2;
      applyView();
    };
    const resetView = () => {
      const rootPosition = layout.nodePositions.get(data.tree.root) || {
        x: layout.contentWidth / 2,
        y: layout.contentHeight / 2,
      };
      viewState.scale = Math.max(.82, Math.min(1.05, 1300 / layout.contentWidth));
      viewState.x = 470 - rootPosition.x * viewState.scale;
      viewState.y = 440 - rootPosition.y * viewState.scale;
      applyView();
    };
    const zoomBy = (factor, center = { x: 800, y: 450 }) => {
      const nextScale = Math.min(2.6, Math.max(.24, viewState.scale * factor));
      const worldX = (center.x - viewState.x) / viewState.scale;
      const worldY = (center.y - viewState.y) / viewState.scale;
      viewState.x = center.x - worldX * nextScale;
      viewState.y = center.y - worldY * nextScale;
      viewState.scale = nextScale;
      applyView();
    };
    const localPoint = (event) => {
      const rect = svg.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * 1600 / rect.width,
        y: (event.clientY - rect.top) * 900 / rect.height,
      };
    };

    svg.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (autoplay) toggleAutoplay();
      const nodeTarget = event.target.closest('.constellation__node');
      dragState = {
        clientX: event.clientX,
        clientY: event.clientY,
        moved: false,
        nodeId: nodeTarget?.dataset.nodeId || null,
        x: viewState.x,
        y: viewState.y,
      };
      svg.setPointerCapture(event.pointerId);
      svg.classList.add('is-dragging');
      tooltip?.classList.remove('is-visible');
    });
    svg.addEventListener('pointermove', (event) => {
      if (!dragState) return;
      const rect = svg.getBoundingClientRect();
      if (Math.hypot(event.clientX - dragState.clientX, event.clientY - dragState.clientY) > 4) dragState.moved = true;
      viewState.x = dragState.x + (event.clientX - dragState.clientX) * 1600 / rect.width;
      viewState.y = dragState.y + (event.clientY - dragState.clientY) * 900 / rect.height;
      applyView();
    });
    const finishDrag = (event) => {
      if (!dragState) return;
      const completed = dragState;
      dragState = null;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      svg.classList.remove('is-dragging');
      if (!completed.moved) {
        if (completed.nodeId) focusPerson(completed.nodeId);
        else clearFocus();
      }
    };
    svg.addEventListener('pointerup', finishDrag);
    svg.addEventListener('pointercancel', (event) => {
      dragState = null;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      svg.classList.remove('is-dragging');
    });
    svg.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (autoplay) toggleAutoplay();
      zoomBy(event.deltaY < 0 ? 1.12 : .89, localPoint(event));
    }, { passive: false });

    document.querySelectorAll('[data-pedigree-action]').forEach((button) => {
      button.addEventListener('click', () => {
        if (autoplay) toggleAutoplay();
        if (button.dataset.pedigreeAction === 'zoom-in') zoomBy(1.2);
        if (button.dataset.pedigreeAction === 'zoom-out') zoomBy(.82);
        if (button.dataset.pedigreeAction === 'fit') fitView();
        if (button.dataset.pedigreeAction === 'reset') {
          clearFocus();
          resetView();
        }
      });
    });
    resetView();
  };

  const renderTimeline = () => {
    const canvas = document.getElementById('timeline-canvas');
    if (!canvas || data.events.length === 0) return;
    const timeline = canvas.closest('.timeline');
    canvas.replaceChildren();
    const events = data.events
      .filter((event) => Number.isFinite(Number(event.year)) && Number(event.year) !== 0)
      .sort((a, b) => Number(a.year) - Number(b.year));
    if (events.length === 0) return;

    const eventPriority = { marriage: 0, birth: 1, death: 2 };
    const eventsByYear = new Map();
    events.forEach((event) => {
      const year = Number(event.year);
      if (!eventsByYear.has(year)) eventsByYear.set(year, []);
      eventsByYear.get(year).push(event);
    });

    const timelineItems = [];
    [...eventsByYear.entries()].forEach(([year, yearEvents]) => {
      const sortedEvents = [...yearEvents].sort((left, right) => (
        (eventPriority[left.type] ?? 9) - (eventPriority[right.type] ?? 9)
        || String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
      ));
      sortedEvents.forEach((event, yearIndex) => timelineItems.push({
        event,
        type: event.type,
        year,
        yearCount: sortedEvents.length,
        yearIndex,
      }));
    });
    timelineItems.sort((left, right) => left.year - right.year || (eventPriority[left.type] ?? 8) - (eventPriority[right.type] ?? 8));

    const occupiedYears = [...eventsByYear.keys()].sort((left, right) => left - right);
    const firstEventYear = occupiedYears[0];
    const lastEventYear = occupiedYears[occupiedYears.length - 1];
    const minYear = Math.floor(firstEventYear / 10) * 10;
    const maxYear = Math.ceil(lastEventYear / 10) * 10;
    const yearSpan = Math.max(10, maxYear - minYear);
    const yearMetrics = new Map([[firstEventYear, 0]]);
    const compressedGaps = [];
    let narrativeSpan = 0;
    occupiedYears.slice(1).forEach((year, index) => {
      const previousYear = occupiedYears[index];
      const difference = year - previousYear;
      let visualDistance = difference;
      if (difference > 5 && difference <= 12) visualDistance = 5 + (difference - 5) * .45;
      if (difference > 12) {
        visualDistance = 8.15 + Math.min(3.2, Math.log2(difference - 10) * .8);
        compressedGaps.push({ from: previousYear, to: year, years: difference });
      }
      narrativeSpan += visualDistance;
      yearMetrics.set(year, narrativeSpan);
    });

    const timelineMetric = (year) => {
      if (timelineScaleMode === 'proportional') return year - minYear;
      return yearMetrics.get(year) ?? 0;
    };
    const metricSpan = timelineScaleMode === 'proportional' ? yearSpan : narrativeSpan;
    const estimatedHeight = Math.max(360, window.innerHeight - 270);
    const maximumOffset = estimatedHeight / 2 - 52;
    const laneOffsets = [];
    for (let depth = 78; depth <= maximumOffset && laneOffsets.length < 8; depth += 94) {
      laneOffsets.push(-depth, depth);
    }
    if (laneOffsets.length < 4) laneOffsets.push(-172, 172);

    const cardWidth = 180;
    const sameYearStep = Math.ceil((cardWidth + 24) / laneOffsets.length);
    const maximumYearCount = Math.max(...[...eventsByYear.values()].map((yearEvents) => yearEvents.length));
    const maximumFanExtent = Math.max(0, (maximumYearCount - 1) / 2 * sameYearStep);
    const axisPadding = Math.max(120, maximumFanExtent + cardWidth / 2 + 20);
    const axisX = (year, width) => metricSpan === 0
      ? width / 2
      : axisPadding + (timelineMetric(year) / metricSpan) * (width - axisPadding * 2);
    const eventX = (item, width) => (
      axisX(item.year, width) + (item.yearIndex - (item.yearCount - 1) / 2) * sameYearStep
    );
    const arrangeItems = (width) => {
      const laneRightEdges = laneOffsets.map(() => Number.NEGATIVE_INFINITY);
      const placements = [];
      let overflow = 0;
      timelineItems.forEach((item, itemIndex) => {
        const x = eventX(item, width);
        const halfWidth = cardWidth / 2;
        const left = x - halfWidth;
        const alternatingOrder = itemIndex % 2 === 0
          ? laneOffsets.map((offset, index) => ({ index, offset }))
          : laneOffsets.map((offset, index) => ({ index, offset })).sort((a, b) => (
            Math.abs(a.offset) - Math.abs(b.offset) || b.offset - a.offset
          ));
        const lane = alternatingOrder.find(({ index }) => left >= laneRightEdges[index] + 24);
        if (!lane) {
          overflow += 1;
          return;
        }
        laneRightEdges[lane.index] = x + halfWidth;
        placements.push({ item, lane: lane.index, offset: lane.offset, x });
      });
      return { overflow, placements };
    };

    let canvasWidth = Math.max(
      window.innerWidth - 96,
      timelineItems.length * 132,
      timelineScaleMode === 'proportional' ? yearSpan * 24 : Math.max(1, narrativeSpan) * 54,
    );
    let arrangement = arrangeItems(canvasWidth);
    for (let attempt = 0; arrangement.overflow > 0 && attempt < 8; attempt += 1) {
      canvasWidth = Math.ceil(canvasWidth * 1.18);
      arrangement = arrangeItems(canvasWidth);
    }
    canvas.style.width = `${canvasWidth}px`;

    const axis = document.createElement('div');
    axis.className = 'timeline__axis';
    canvas.append(axis);

    const narrativeDecades = new Map();
    occupiedYears.forEach((year) => {
      const decade = Math.floor(year / 10) * 10;
      if (!narrativeDecades.has(decade)) narrativeDecades.set(decade, { label: decade, year });
    });
    const decadeMarkers = timelineScaleMode === 'proportional'
      ? Array.from({ length: Math.floor((maxYear - minYear) / 10) + 1 }, (_, index) => ({
        label: minYear + index * 10,
        year: minYear + index * 10,
      }))
      : [...narrativeDecades.values()];
    decadeMarkers.forEach(({ label, year }) => {
      const marker = document.createElement('span');
      marker.className = 'timeline__decade';
      marker.style.left = `${axisX(year, canvasWidth)}px`;
      marker.textContent = `${label}s`;
      canvas.append(marker);
    });

    if (timelineScaleMode === 'narrative') {
      compressedGaps.forEach((gap) => {
        const gapMarker = document.createElement('span');
        gapMarker.className = 'timeline__gap';
        gapMarker.style.left = `${(axisX(gap.from, canvasWidth) + axisX(gap.to, canvasWidth)) / 2}px`;
        gapMarker.title = `${gap.from}年至${gap.to}年，时间跨度${gap.years}年`;
        const breakMark = document.createElement('i');
        const label = document.createElement('b');
        label.textContent = `跨越 ${gap.years} 年`;
        gapMarker.append(breakMark, label);
        canvas.append(gapMarker);
      });
    }

    document.querySelectorAll('[data-timeline-scale]').forEach((button) => {
      const active = button.dataset.timelineScale === timelineScaleMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const timelineHint = timeline?.querySelector('.timeline__hint');
    if (timelineHint) {
      timelineHint.textContent = timelineScaleMode === 'narrative'
        ? '弹性时间轴 · // 表示长时间压缩 · 悬停卡片置于最上层'
        : '真实年份比例 · 横向滚动阅览 · 悬停卡片置于最上层';
    }

    arrangement.placements.forEach(({ item, offset, x }, index) => {
      const above = offset < 0;
      const card = document.createElement('article');
      card.className = `timeline__event timeline__event--${item.type} ${above ? 'is-above' : 'is-below'}`;
      card.tabIndex = 0;
      card.setAttribute('aria-label', `${item.year}年，${item.event.label || '家族记事'}，${item.event.name || '未具名'}`);
      card.style.left = `${x}px`;
      card.style.top = `calc(50% + ${offset}px)`;
      card.style.setProperty('--event-stem', `${Math.max(34, Math.abs(offset) - 43)}px`);
      card.style.setProperty('--event-index', String(index));

      const year = document.createElement('span');
      year.className = 'timeline__event-year';
      year.textContent = `${item.year} · ${item.event.label}`;
      const name = document.createElement('strong');
      name.className = 'timeline__event-name';
      name.textContent = item.event.name || '家族记事';
      const meta = document.createElement('span');
      meta.className = 'timeline__event-meta';
      meta.textContent = item.event.place || (item.event.type === 'birth' ? '一个新的故事由此开始' : '被时间珍藏的家族记忆');
      const dot = document.createElement('i');
      dot.className = 'timeline__event-dot';
      card.append(year, name, meta, dot);
      canvas.append(card);
    });
  };

  const renderOverview = () => {
    const surnameContainer = document.getElementById('overview-surnames');
    const surnames = [...new Set(data.nodes.map((node) => node.surname).filter(Boolean))];
    surnames.slice(0, 12).forEach((surname) => {
      const chip = document.createElement('span');
      chip.className = 'overview__surname';
      chip.textContent = surname;
      surnameContainer?.append(chip);
    });

    const totalGender = Math.max(1, data.stats.male + data.stats.female);
    document.getElementById('overview-donut')?.style.setProperty('--male-ratio', `${data.stats.male / totalGender * 100}%`);

    const cohorts = new Map();
    data.nodes.forEach((node) => {
      if (!node.birthYear) return;
      const decade = Math.floor(Number(node.birthYear) / 10) * 10;
      cohorts.set(decade, (cohorts.get(decade) || 0) + 1);
    });
    const cohortData = [...cohorts.entries()].sort((a, b) => a[0] - b[0]);
    const recentCohorts = cohortData.slice(-8);
    const maxValue = Math.max(1, ...recentCohorts.map((entry) => entry[1]));
    const bars = document.getElementById('overview-bars');
    recentCohorts.forEach(([decade, count]) => {
      const bar = document.createElement('span');
      bar.className = 'overview__bar';
      bar.style.setProperty('--height', `${Math.max(12, count / maxValue * 100)}%`);
      const label = document.createElement('span');
      label.textContent = String(decade).slice(-2);
      const value = document.createElement('i');
      value.textContent = count;
      bar.append(label, value);
      bars?.append(bar);
    });
  };

  const restartProgress = () => {
    if (!progress) return;
    progress.classList.remove('is-running');
    void progress.offsetWidth;
    if (autoplay) progress.classList.add('is-running');
  };

  const scheduleNext = () => {
    window.clearTimeout(autoplayTimer);
    if (!autoplay) return;
    autoplayTimer = window.setTimeout(() => {
      const nextIndex = (modes.indexOf(activeMode) + 1) % modes.length;
      setMode(modes[nextIndex]);
    }, 12000);
  };

  const setMode = (mode) => {
    if (!modes.includes(mode)) return;
    activeMode = mode;
    modeButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.mode === mode));
    panels.forEach((panel) => {
      const active = panel.dataset.panel === mode;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    const index = modes.indexOf(mode);
    if (current) current.textContent = String(index + 1).padStart(2, '0');
    if (description) description.textContent = descriptions[mode];
    window.history.replaceState(null, '', `#${mode}`);
    restartProgress();
    scheduleNext();
  };

  const toggleAutoplay = () => {
    autoplay = !autoplay;
    autoplayButton?.setAttribute('aria-pressed', String(autoplay));
    if (autoplayLabel) autoplayLabel.textContent = autoplay ? '暂停巡展' : '继续巡展';
    restartProgress();
    scheduleNext();
  };

  const updateClock = () => {
    const clock = document.getElementById('family-screen-clock');
    if (!clock) return;
    const now = new Date();
    clock.dateTime = now.toISOString();
    clock.textContent = new Intl.DateTimeFormat(document.documentElement.lang || 'zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now).replace('/', ' · ');
  };

  modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  document.querySelectorAll('[data-timeline-scale]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextMode = button.dataset.timelineScale;
      if (!['narrative', 'proportional'].includes(nextMode) || nextMode === timelineScaleMode) return;
      if (autoplay) toggleAutoplay();
      const scroller = document.querySelector('.timeline__scroll');
      const scrollableWidth = Math.max(1, (scroller?.scrollWidth || 1) - (scroller?.clientWidth || 0));
      const scrollProgress = (scroller?.scrollLeft || 0) / scrollableWidth;
      timelineScaleMode = nextMode;
      renderTimeline();
      window.requestAnimationFrame(() => {
        if (!scroller) return;
        scroller.scrollLeft = scrollProgress * Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      });
    });
  });
  autoplayButton?.addEventListener('click', toggleAutoplay);
  document.getElementById('family-screen-fullscreen')?.addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.getElementById('family-screen')?.requestFullscreen();
  });

  document.addEventListener('fullscreenchange', () => {
    const button = document.getElementById('family-screen-fullscreen');
    if (button) button.setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '进入全屏');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key >= '1' && event.key <= '3') setMode(modes[Number(event.key) - 1]);
    if (event.key.toLowerCase() === 'f') document.getElementById('family-screen-fullscreen')?.click();
    if (event.key === ' ') {
      event.preventDefault();
      toggleAutoplay();
    }
  });

  renderConstellation();
  renderTimeline();
  renderOverview();
  updateClock();
  window.setInterval(updateClock, 30000);
  setMode(modes.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'constellation');
}

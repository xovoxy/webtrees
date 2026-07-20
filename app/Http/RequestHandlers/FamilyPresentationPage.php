<?php

/**
 * webtrees: online genealogy
 * Copyright (C) 2026 webtrees development team
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

declare(strict_types=1);

namespace Fisharebest\Webtrees\Http\RequestHandlers;

use Fisharebest\Webtrees\Contracts\UserInterface;
use Fisharebest\Webtrees\DB;
use Fisharebest\Webtrees\Family;
use Fisharebest\Webtrees\Http\ViewResponseTrait;
use Fisharebest\Webtrees\Individual;
use Fisharebest\Webtrees\Registry;
use Fisharebest\Webtrees\Validator;
use Illuminate\Support\Collection;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\RequestHandlerInterface;

use function array_column;
use function array_filter;
use function array_unique;
use function array_values;
use function count;
use function html_entity_decode;
use function in_array;
use function max;
use function min;
use function route;
use function strip_tags;

use const ENT_QUOTES;

/**
 * A dedicated, full-screen presentation of a family tree.
 */
final class FamilyPresentationPage implements RequestHandlerInterface
{
    use ViewResponseTrait;

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        $this->layout = 'layouts/family-presentation';

        $tree = Validator::attributes($request)->tree();
        $user = Validator::attributes($request)->user();
        $xref = Validator::attributes($request)->isXref()->string('xref', '');

        $default_xref = $tree->getUserPreference($user, UserInterface::PREF_TREE_ACCOUNT_XREF)
            ?: $tree->getPreference('PEDIGREE_ROOT_ID');

        /** @var Collection<int,Individual> $individuals */
        $individuals = DB::table('individuals')
            ->where('i_file', '=', $tree->id())
            ->orderBy('i_id')
            ->get()
            ->map(Registry::individualFactory()->mapper($tree))
            ->filter(static fn (Individual $individual): bool => $individual->canShow())
            ->values();

        if ($individuals->isEmpty()) {
            $root = null;
        } else {
            $root = $individuals->first(static fn (Individual $individual): bool => $individual->xref() === ($xref ?: $default_xref))
                ?? $individuals->first();
        }

        $visible_xrefs = $individuals
            ->mapWithKeys(static fn (Individual $individual): array => [$individual->xref() => true])
            ->all();

        /** @var Collection<int,Family> $families */
        $families = DB::table('families')
            ->where('f_file', '=', $tree->id())
            ->orderBy('f_id')
            ->get()
            ->map(Registry::familyFactory()->mapper($tree))
            ->filter(static fn (Family $family): bool => $family->canShow())
            ->values();

        $nodes = $individuals->map(static function (Individual $individual) use ($root): array {
            $names        = $individual->getAllNames();
            $primary_name = $names[$individual->getPrimaryName()];
            $birth_date   = $individual->getBirthDate();
            $death_date   = $individual->getDeathDate();
            $birth_year   = $birth_date->isOK() ? $birth_date->minimumDate()->year : null;
            $death_year   = $death_date->isOK() ? $death_date->minimumDate()->year : null;

            return [
                'id'          => $individual->xref(),
                'name'        => self::plainText($individual->fullName()),
                'surname'     => self::plainText($primary_name['surname'] ?? ''),
                'sex'         => $individual->sex(),
                'birthYear'   => $birth_year ?: null,
                'birthMin'    => $birth_date->isOK() ? $birth_date->minimumJulianDay() : null,
                'birthMax'    => $birth_date->isOK() ? $birth_date->maximumJulianDay() : null,
                'deathYear'   => $death_year ?: null,
                'birthPlace'  => self::plainText($individual->getBirthPlace()->shortName()),
                'living'      => !$individual->isDead(),
                'isRoot'      => $root instanceof Individual && $individual->xref() === $root->xref(),
            ];
        })->all();

        $family_data = $families->map(static function (Family $family) use ($visible_xrefs): array {
            $parents = $family->spouses()
                ->map(static fn (Individual $individual): string => $individual->xref())
                ->filter(static fn (string $family_xref): bool => isset($visible_xrefs[$family_xref]))
                ->values()
                ->all();
            $children = $family->children()
                ->map(static fn (Individual $individual): string => $individual->xref())
                ->filter(static fn (string $family_xref): bool => isset($visible_xrefs[$family_xref]))
                ->values()
                ->all();
            $marriage_date = $family->getMarriageDate();

            return [
                'id'           => $family->xref(),
                'parents'      => $parents,
                'children'     => $children,
                'marriageYear' => $marriage_date->isOK() ? ($marriage_date->minimumDate()->year ?: null) : null,
                'place'        => self::plainText($family->getMarriagePlace()->shortName()),
            ];
        })->filter(static fn (array $family): bool => $family['parents'] !== [] || $family['children'] !== [])->all();

        $events = [];
        foreach ($nodes as $node) {
            if ($node['birthYear'] !== null) {
                $events[] = [
                    'year'  => $node['birthYear'],
                    'type'  => 'birth',
                    'label' => '诞生',
                    'name'  => $node['name'],
                    'place' => $node['birthPlace'],
                ];
            }
            if ($node['deathYear'] !== null) {
                $events[] = [
                    'year'  => $node['deathYear'],
                    'type'  => 'death',
                    'label' => '离世',
                    'name'  => $node['name'],
                    'place' => '',
                ];
            }
        }
        foreach ($family_data as $family) {
            if ($family['marriageYear'] !== null) {
                $family_names = $individuals
                    ->filter(static fn (Individual $individual): bool => in_array($individual->xref(), $family['parents'], true))
                    ->map(static fn (Individual $individual): string => self::plainText($individual->fullName()))
                    ->implode(' · ');
                $events[] = [
                    'year'  => $family['marriageYear'],
                    'type'  => 'marriage',
                    'label' => '结为家庭',
                    'name'  => $family_names,
                    'place' => $family['place'],
                ];
            }
        }

        $birth_years = array_values(array_filter(array_column($nodes, 'birthYear')));
        $surnames    = array_values(array_filter(array_unique(array_column($nodes, 'surname'))));

        $presentation_data = [
            'tree'     => [
                'title' => self::plainText($tree->title()),
                'root'  => $root?->xref(),
            ],
            'nodes'    => $nodes,
            'families' => array_values($family_data),
            'events'   => $events,
            'stats'    => [
                'individuals' => count($nodes),
                'families'    => count($family_data),
                'living'      => count(array_filter($nodes, static fn (array $node): bool => $node['living'])),
                'male'        => count(array_filter($nodes, static fn (array $node): bool => $node['sex'] === 'M')),
                'female'      => count(array_filter($nodes, static fn (array $node): bool => $node['sex'] === 'F')),
                'surnames'    => count($surnames),
                'earliest'    => $birth_years === [] ? null : min($birth_years),
                'latest'      => $birth_years === [] ? null : max($birth_years),
            ],
        ];

        return $this->viewResponse('family-presentation/page', [
            'data'        => $presentation_data,
            'exit_url'    => route(TreePage::class, ['tree' => $tree->name()]),
            'meta_robots' => 'noindex,nofollow',
            'title'       => '家族大屏 · ' . self::plainText($tree->title()),
            'tree'        => $tree,
        ]);
    }

    private static function plainText(string $value): string
    {
        return html_entity_decode(strip_tags($value), ENT_QUOTES, 'UTF-8');
    }
}

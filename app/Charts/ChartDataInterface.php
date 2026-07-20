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

namespace Fisharebest\Webtrees\Charts;

use JsonSerializable;

interface ChartDataInterface extends JsonSerializable
{
    public const string COLOR_WHITE = '#ffffff';

    public const string COLOR_DEFAULT = '#557f88';

    public const string COLOR_MALE = '#557f88';

    public const string COLOR_FEMALE = '#9a6076';

    public const string COLOR_UNKNOWN_SEX = '#68806b';
    public const string COLOR_OTHER_SEX = '#ad6842';

    public const string COLOR_CHART_RED = '#ad6842';

    public const string COLOR_LIVING = self::COLOR_DEFAULT;
    public const string COLOR_DEAD = self::COLOR_EMPTY;

    public const string COLOR_EMPTY = '#8b857c';

    public const array COLOR_PALETTE = [
        '#557F88', '#9A6076', '#AD6842', '#68806B',
        '#8A8752', '#526B79', '#776B86', '#795148',
        '#3F7164', '#B7834F', '#8B7280', '#6B8179',
        '#657780', '#A07B59', '#777187', '#78939A',
    ];

    public function hasData(): bool;
}

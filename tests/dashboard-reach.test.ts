import { describe, expect, it } from 'vitest';
import { reachTargets } from '../packages/dashboard/src/server/reach.js';

describe('reach targets', () => {
  it('measures to the texts the completion checks expect and to what the goal quotes, once each', () => {
    expect(reachTargets({ goal: "Find the product 'Thor Hammer', add it to the cart, then open the cart.", verify: { all: [{ urlIncludes: '/checkout' }, { textVisible: 'Thor Hammer' }] } })).toEqual(['Thor Hammer']);
    expect(reachTargets({ goal: '화성 여행 사이트에서 “Book Tickets” 페이지로 이동한다.', verify: { all: [{ textVisibleExact: 'Tickets' }] } })).toEqual(['Tickets', 'Book Tickets']);
    expect(reachTargets({ goal: 'Open the cart.', verify: { all: [{ urlIncludes: '/cart' }] } })).toEqual([]);
  });
});

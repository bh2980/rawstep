// Generated solely from the semantic-family training partition.
export const LEARNED_CORPUS_RULES = [
  {
    "id": "consensus-26ee482fc9a95c9c",
    "key": {
      "at": "nvda",
      "beforeMode": "auto",
      "browser": "chrome",
      "command": "next_focusable_item",
      "flags": {},
      "hasValue": false,
      "role": "button"
    },
    "template": "{name} button",
    "allowedVersions": [
      {
        "atVersion": "2021.1",
        "browserVersion": "91",
        "osVersion": "Windows 10 version 21h1"
      },
      {
        "atVersion": "2021.1",
        "browserVersion": "92",
        "osVersion": "Windows 10 version 21h1"
      },
      {
        "atVersion": "2025.3.1",
        "browserVersion": "143",
        "osVersion": "Windows 11 version 21H2"
      }
    ],
    "trainingFamilies": [
      "semantic-fixture:4d1e02fb72dd43207b5fb3b3b45673a000b54ab4da55bce32dcd51c6edc3d4b4",
      "semantic-fixture:82ad205f69e40613d9ffb0edb837c17bebfd93546cc94fe9d5a74e952dee2b32",
      "semantic-fixture:ced15003d94f5f85394be729819abb164eac223bf9f5372895392e96024c163a"
    ],
    "trainingSourceIds": [
      "a11ysupport:tech/aria/aria-controls:nvda:chrome:0",
      "a11ysupport:tech/aria/aria-label:nvda:chrome:1",
      "a11ysupport:tech/html/buttons:nvda:chrome:1"
    ],
    "trainingRecords": 3,
    "scope": "cross-version-consensus-with-exact-observed-version-allowlist",
    "nativeParityEstablished": false,
    "trainingFixturePaths": [
      "data/tests/html/aria/aria-controls.html",
      "data/tests/html/aria/aria-labelling.html",
      "data/tests/html/html/buttons.html"
    ]
  },
  {
    "id": "consensus-eff9db94ad711b5a",
    "key": {
      "at": "nvda",
      "beforeMode": "auto",
      "browser": "chrome",
      "command": "next_item",
      "flags": {},
      "hasValue": false,
      "role": "button"
    },
    "template": "button {name}",
    "allowedVersions": [
      {
        "atVersion": "2021.1",
        "browserVersion": "92",
        "osVersion": "Windows 10 version 21h1"
      },
      {
        "atVersion": "2025.3.1",
        "browserVersion": "143",
        "osVersion": "Windows 11 version 21H2"
      }
    ],
    "trainingFamilies": [
      "semantic-fixture:4d1e02fb72dd43207b5fb3b3b45673a000b54ab4da55bce32dcd51c6edc3d4b4",
      "semantic-fixture:ced15003d94f5f85394be729819abb164eac223bf9f5372895392e96024c163a"
    ],
    "trainingSourceIds": [
      "a11ysupport:tech/aria/aria-label:nvda:chrome:0",
      "a11ysupport:tech/html/buttons:nvda:chrome:0"
    ],
    "trainingRecords": 2,
    "scope": "cross-version-consensus-with-exact-observed-version-allowlist",
    "nativeParityEstablished": false,
    "trainingFixturePaths": [
      "data/tests/html/aria/aria-labelling.html",
      "data/tests/html/html/buttons.html"
    ]
  },
  {
    "id": "consensus-8f99600fec02014d",
    "key": {
      "at": "nvda",
      "beforeMode": "auto",
      "browser": "edge",
      "command": "next_focusable_item",
      "flags": {},
      "hasValue": false,
      "role": "button"
    },
    "template": "{name} button",
    "allowedVersions": [
      {
        "atVersion": "2021.1",
        "browserVersion": "91",
        "osVersion": "Windows 10 version 21h1"
      },
      {
        "atVersion": "2021.1",
        "browserVersion": "92",
        "osVersion": "Windows 10 version 21h1"
      }
    ],
    "trainingFamilies": [
      "semantic-fixture:4d1e02fb72dd43207b5fb3b3b45673a000b54ab4da55bce32dcd51c6edc3d4b4",
      "semantic-fixture:82ad205f69e40613d9ffb0edb837c17bebfd93546cc94fe9d5a74e952dee2b32",
      "semantic-fixture:ced15003d94f5f85394be729819abb164eac223bf9f5372895392e96024c163a"
    ],
    "trainingSourceIds": [
      "a11ysupport:tech/aria/aria-controls:nvda:edge:0",
      "a11ysupport:tech/aria/aria-label:nvda:edge:1",
      "a11ysupport:tech/html/buttons:nvda:edge:1"
    ],
    "trainingRecords": 3,
    "scope": "cross-version-consensus-with-exact-observed-version-allowlist",
    "nativeParityEstablished": false,
    "trainingFixturePaths": [
      "data/tests/html/aria/aria-controls.html",
      "data/tests/html/aria/aria-labelling.html",
      "data/tests/html/html/buttons.html"
    ]
  },
  {
    "id": "consensus-d92fbd6a23e2f7f1",
    "key": {
      "at": "nvda",
      "beforeMode": "auto",
      "browser": "edge",
      "command": "next_item",
      "flags": {},
      "hasValue": false,
      "role": "button"
    },
    "template": "button {name}",
    "allowedVersions": [
      {
        "atVersion": "2021.1",
        "browserVersion": "92",
        "osVersion": "Windows 10 version 21h1"
      }
    ],
    "trainingFamilies": [
      "semantic-fixture:4d1e02fb72dd43207b5fb3b3b45673a000b54ab4da55bce32dcd51c6edc3d4b4",
      "semantic-fixture:ced15003d94f5f85394be729819abb164eac223bf9f5372895392e96024c163a"
    ],
    "trainingSourceIds": [
      "a11ysupport:tech/aria/aria-label:nvda:edge:0",
      "a11ysupport:tech/html/buttons:nvda:edge:0"
    ],
    "trainingRecords": 2,
    "scope": "cross-version-consensus-with-exact-observed-version-allowlist",
    "nativeParityEstablished": false,
    "trainingFixturePaths": [
      "data/tests/html/aria/aria-labelling.html",
      "data/tests/html/html/buttons.html"
    ]
  },
  {
    "id": "consensus-9f9fd6bb1ad422c7",
    "key": {
      "at": "nvda",
      "beforeMode": "auto",
      "browser": "firefox",
      "command": "next_focusable_item",
      "flags": {},
      "hasValue": false,
      "role": "button"
    },
    "template": "{name} button",
    "allowedVersions": [
      {
        "atVersion": "2019.1.1",
        "browserVersion": "68",
        "osVersion": "Windows 10 version 1903"
      },
      {
        "atVersion": "2019.2",
        "browserVersion": "69",
        "osVersion": "Windows 10 version 1903"
      }
    ],
    "trainingFamilies": [
      "semantic-fixture:4d1e02fb72dd43207b5fb3b3b45673a000b54ab4da55bce32dcd51c6edc3d4b4",
      "semantic-fixture:ced15003d94f5f85394be729819abb164eac223bf9f5372895392e96024c163a"
    ],
    "trainingSourceIds": [
      "a11ysupport:tech/aria/aria-label:nvda:firefox:1",
      "a11ysupport:tech/html/buttons:nvda:firefox:1"
    ],
    "trainingRecords": 2,
    "scope": "cross-version-consensus-with-exact-observed-version-allowlist",
    "nativeParityEstablished": false,
    "trainingFixturePaths": [
      "data/tests/html/aria/aria-labelling.html",
      "data/tests/html/html/buttons.html"
    ]
  },
  {
    "id": "consensus-62b39bd960f8cf24",
    "key": {
      "at": "nvda",
      "beforeMode": "auto",
      "browser": "firefox",
      "command": "next_item",
      "flags": {},
      "hasValue": false,
      "role": "button"
    },
    "template": "button {name}",
    "allowedVersions": [
      {
        "atVersion": "2019.1.1",
        "browserVersion": "68",
        "osVersion": "Windows 10 version 1903"
      },
      {
        "atVersion": "2019.2",
        "browserVersion": "69",
        "osVersion": "Windows 10 version 1903"
      }
    ],
    "trainingFamilies": [
      "semantic-fixture:4d1e02fb72dd43207b5fb3b3b45673a000b54ab4da55bce32dcd51c6edc3d4b4",
      "semantic-fixture:ced15003d94f5f85394be729819abb164eac223bf9f5372895392e96024c163a"
    ],
    "trainingSourceIds": [
      "a11ysupport:tech/aria/aria-label:nvda:firefox:0",
      "a11ysupport:tech/html/buttons:nvda:firefox:0"
    ],
    "trainingRecords": 2,
    "scope": "cross-version-consensus-with-exact-observed-version-allowlist",
    "nativeParityEstablished": false,
    "trainingFixturePaths": [
      "data/tests/html/aria/aria-labelling.html",
      "data/tests/html/html/buttons.html"
    ]
  },
  {
    "id": "consensus-1680884185a35901",
    "key": {
      "at": "voiceover",
      "beforeMode": "auto",
      "browser": "safari",
      "command": "next_focusable_item",
      "flags": {},
      "hasValue": false,
      "role": "button"
    },
    "template": "{name} button",
    "allowedVersions": [
      {
        "atVersion": "10.14.5",
        "browserVersion": "12.1.1",
        "osVersion": "10.14.5"
      },
      {
        "atVersion": "10.14.6",
        "browserVersion": "13.0.1",
        "osVersion": "10.14.6"
      }
    ],
    "trainingFamilies": [
      "semantic-fixture:4d1e02fb72dd43207b5fb3b3b45673a000b54ab4da55bce32dcd51c6edc3d4b4",
      "semantic-fixture:ced15003d94f5f85394be729819abb164eac223bf9f5372895392e96024c163a"
    ],
    "trainingSourceIds": [
      "a11ysupport:tech/aria/aria-label:vo_macos:safari:1",
      "a11ysupport:tech/html/buttons:vo_macos:safari:1"
    ],
    "trainingRecords": 2,
    "scope": "cross-version-consensus-with-exact-observed-version-allowlist",
    "nativeParityEstablished": false,
    "trainingFixturePaths": [
      "data/tests/html/aria/aria-labelling.html",
      "data/tests/html/html/buttons.html"
    ]
  },
  {
    "id": "consensus-2e8b1802e5e09153",
    "key": {
      "at": "voiceover",
      "beforeMode": "auto",
      "browser": "safari",
      "command": "next_item",
      "flags": {},
      "hasValue": false,
      "role": "button"
    },
    "template": "{name} button",
    "allowedVersions": [
      {
        "atVersion": "10.14.5",
        "browserVersion": "12.1.1",
        "osVersion": "10.14.5"
      },
      {
        "atVersion": "10.14.6",
        "browserVersion": "13.0.1",
        "osVersion": "10.14.6"
      }
    ],
    "trainingFamilies": [
      "semantic-fixture:4d1e02fb72dd43207b5fb3b3b45673a000b54ab4da55bce32dcd51c6edc3d4b4",
      "semantic-fixture:ced15003d94f5f85394be729819abb164eac223bf9f5372895392e96024c163a"
    ],
    "trainingSourceIds": [
      "a11ysupport:tech/aria/aria-label:vo_macos:safari:0",
      "a11ysupport:tech/html/buttons:vo_macos:safari:0"
    ],
    "trainingRecords": 2,
    "scope": "cross-version-consensus-with-exact-observed-version-allowlist",
    "nativeParityEstablished": false,
    "trainingFixturePaths": [
      "data/tests/html/aria/aria-labelling.html",
      "data/tests/html/html/buttons.html"
    ]
  }
] as const;
export const CORPUS_EVALUATION = {
  "schemaVersion": "1.0",
  "evaluationStatus": "exploratory-validation-after-initial-holdout-inspection",
  "familyGrouping": "semantic fixture signature, output-independent, retains browser/version siblings together",
  "model": "version-allowlisted-consensus-v1",
  "seed": "rawstep-fixture-family-holdout-v1",
  "minimumTrainingFamilies": 2,
  "trainingRuleCount": 8,
  "fixedHoldout": {
    "records": 509,
    "staticFeatureRecords": 182,
    "predicted": 4,
    "unsupported": 505,
    "exactMatches": 4,
    "mismatches": 0,
    "tokenBagAgreement": 4,
    "coverageOverAll": 0.007858546168958742,
    "exactOverAll": 0.007858546168958742,
    "exactAmongPredicted": 1.0
  },
  "leaveOneUnseenFamilyOut": {
    "records": 2606,
    "staticFeatureRecords": 478,
    "predicted": 18,
    "unsupported": 2588,
    "exactMatches": 8,
    "mismatches": 10,
    "tokenBagAgreement": 8,
    "coverageOverAll": 0.006907137375287797,
    "exactOverAll": 0.0030698388334612432,
    "exactAmongPredicted": 0.4444444444444444
  },
  "excludedPreviouslyCalibratedRowsFromLofo": 308,
  "lofoFamilies": 105,
  "originalStrictFixedSplit": {
    "records": 230,
    "staticFeatureRecords": 21,
    "predicted": 0,
    "unsupported": 230,
    "exactMatches": 0,
    "tokenBagAgreement": 0,
    "coverageOverAll": 0.0,
    "exactOverAll": 0.0,
    "exactAmongPredicted": null
  },
  "leakageControls": [
    "All records sharing one fixture family, including browser/version siblings, remain together.",
    "Previously hand-calibrated families are training-only and not scored as heldout.",
    "Each LOFO model excludes every record from its evaluated family.",
    "Version allowlists are built only from that fold training data.",
    "Runtime rules use only the deterministic semantic-family training partition, not its heldout labels or LOFO outputs.",
    "Grouping was refined after the initial run to merge near-clone fixtures; these are explicitly exploratory results, not an untouched confirmatory test."
  ],
  "limitations": [
    "Static HTML and declared target/setup are not native AX or observed focus/cursor.",
    "All source AT settings remain unknown where not reported.",
    "Only unambiguous isolated navigation targets can produce features.",
    "ARIA-AT sequence target alignment remains unsupported in this evaluator and is counted in the full denominator.",
    "Exact means case/whitespace/comma/full-stop-normalized speech agreement.",
    "Token bag agreement ignores order and is only a lexical proxy, not accessibility semantic correctness.",
    "No heldout label influenced templates or conflict selection; poor coverage is retained, not repaired from test labels.",
    "This is a rule-based corpus assessment, not native VO/NVDA performance or universal mock accuracy.",
    "The secondary consensus model pools only identical training templates across versions, then requires the exact AT/browser/OS tuple to have occurred in training.",
    "LOFO and fixed split are separate evaluation designs; neither replaces the unfavorable original result."
  ],
  "fixedByReaderRole": [
    {
      "at": "nvda",
      "role": "banner",
      "records": 6,
      "staticFeatureRecords": 6,
      "predicted": 0,
      "unsupported": 6,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "button",
      "records": 33,
      "staticFeatureRecords": 33,
      "predicted": 4,
      "unsupported": 29,
      "exactMatches": 4,
      "mismatches": 0,
      "tokenBagAgreement": 4,
      "coverageOverAll": 0.12121212121212122,
      "exactOverAll": 0.12121212121212122,
      "exactAmongPredicted": 1.0
    },
    {
      "at": "nvda",
      "role": "combobox",
      "records": 12,
      "staticFeatureRecords": 12,
      "predicted": 0,
      "unsupported": 12,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "complementary",
      "records": 6,
      "staticFeatureRecords": 6,
      "predicted": 0,
      "unsupported": 6,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "contentinfo",
      "records": 6,
      "staticFeatureRecords": 6,
      "predicted": 0,
      "unsupported": 6,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "link",
      "records": 6,
      "staticFeatureRecords": 6,
      "predicted": 0,
      "unsupported": 6,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "main",
      "records": 6,
      "staticFeatureRecords": 6,
      "predicted": 0,
      "unsupported": 6,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "navigation",
      "records": 6,
      "staticFeatureRecords": 6,
      "predicted": 0,
      "unsupported": 6,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "textbox",
      "records": 57,
      "staticFeatureRecords": 57,
      "predicted": 0,
      "unsupported": 57,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "unknown",
      "records": 204,
      "staticFeatureRecords": 0,
      "predicted": 0,
      "unsupported": 204,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "banner",
      "records": 2,
      "staticFeatureRecords": 2,
      "predicted": 0,
      "unsupported": 2,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "button",
      "records": 9,
      "staticFeatureRecords": 9,
      "predicted": 0,
      "unsupported": 9,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "combobox",
      "records": 4,
      "staticFeatureRecords": 4,
      "predicted": 0,
      "unsupported": 4,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "complementary",
      "records": 2,
      "staticFeatureRecords": 2,
      "predicted": 0,
      "unsupported": 2,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "contentinfo",
      "records": 2,
      "staticFeatureRecords": 2,
      "predicted": 0,
      "unsupported": 2,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "link",
      "records": 2,
      "staticFeatureRecords": 2,
      "predicted": 0,
      "unsupported": 2,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "main",
      "records": 2,
      "staticFeatureRecords": 2,
      "predicted": 0,
      "unsupported": 2,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "navigation",
      "records": 2,
      "staticFeatureRecords": 2,
      "predicted": 0,
      "unsupported": 2,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "textbox",
      "records": 19,
      "staticFeatureRecords": 19,
      "predicted": 0,
      "unsupported": 19,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "unknown",
      "records": 123,
      "staticFeatureRecords": 0,
      "predicted": 0,
      "unsupported": 123,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    }
  ],
  "lofoByReaderRole": [
    {
      "at": "nvda",
      "role": "alert",
      "records": 3,
      "staticFeatureRecords": 3,
      "predicted": 0,
      "unsupported": 3,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "banner",
      "records": 12,
      "staticFeatureRecords": 12,
      "predicted": 0,
      "unsupported": 12,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "button",
      "records": 53,
      "staticFeatureRecords": 53,
      "predicted": 16,
      "unsupported": 37,
      "exactMatches": 8,
      "mismatches": 8,
      "tokenBagAgreement": 8,
      "coverageOverAll": 0.3018867924528302,
      "exactOverAll": 0.1509433962264151,
      "exactAmongPredicted": 0.5
    },
    {
      "at": "nvda",
      "role": "combobox",
      "records": 21,
      "staticFeatureRecords": 21,
      "predicted": 0,
      "unsupported": 21,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "complementary",
      "records": 12,
      "staticFeatureRecords": 12,
      "predicted": 0,
      "unsupported": 12,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "contentinfo",
      "records": 12,
      "staticFeatureRecords": 12,
      "predicted": 0,
      "unsupported": 12,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "group",
      "records": 22,
      "staticFeatureRecords": 22,
      "predicted": 0,
      "unsupported": 22,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "heading",
      "records": 3,
      "staticFeatureRecords": 3,
      "predicted": 0,
      "unsupported": 3,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "img",
      "records": 3,
      "staticFeatureRecords": 3,
      "predicted": 0,
      "unsupported": 3,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "link",
      "records": 6,
      "staticFeatureRecords": 6,
      "predicted": 0,
      "unsupported": 6,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "main",
      "records": 12,
      "staticFeatureRecords": 12,
      "predicted": 0,
      "unsupported": 12,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "navigation",
      "records": 12,
      "staticFeatureRecords": 12,
      "predicted": 0,
      "unsupported": 12,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "searchbox",
      "records": 9,
      "staticFeatureRecords": 9,
      "predicted": 0,
      "unsupported": 9,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "spinbutton",
      "records": 9,
      "staticFeatureRecords": 9,
      "predicted": 0,
      "unsupported": 9,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "status",
      "records": 3,
      "staticFeatureRecords": 3,
      "predicted": 0,
      "unsupported": 3,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "textbox",
      "records": 162,
      "staticFeatureRecords": 162,
      "predicted": 2,
      "unsupported": 160,
      "exactMatches": 0,
      "mismatches": 2,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.012345679012345678,
      "exactOverAll": 0.0,
      "exactAmongPredicted": 0.0
    },
    {
      "at": "nvda",
      "role": "tooltip",
      "records": 3,
      "staticFeatureRecords": 3,
      "predicted": 0,
      "unsupported": 3,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "nvda",
      "role": "unknown",
      "records": 1042,
      "staticFeatureRecords": 0,
      "predicted": 0,
      "unsupported": 1042,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "alert",
      "records": 1,
      "staticFeatureRecords": 1,
      "predicted": 0,
      "unsupported": 1,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "banner",
      "records": 4,
      "staticFeatureRecords": 4,
      "predicted": 0,
      "unsupported": 4,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "button",
      "records": 15,
      "staticFeatureRecords": 15,
      "predicted": 0,
      "unsupported": 15,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "combobox",
      "records": 7,
      "staticFeatureRecords": 7,
      "predicted": 0,
      "unsupported": 7,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "complementary",
      "records": 4,
      "staticFeatureRecords": 4,
      "predicted": 0,
      "unsupported": 4,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "contentinfo",
      "records": 4,
      "staticFeatureRecords": 4,
      "predicted": 0,
      "unsupported": 4,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "group",
      "records": 12,
      "staticFeatureRecords": 12,
      "predicted": 0,
      "unsupported": 12,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "heading",
      "records": 2,
      "staticFeatureRecords": 2,
      "predicted": 0,
      "unsupported": 2,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "img",
      "records": 1,
      "staticFeatureRecords": 1,
      "predicted": 0,
      "unsupported": 1,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "link",
      "records": 2,
      "staticFeatureRecords": 2,
      "predicted": 0,
      "unsupported": 2,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "main",
      "records": 4,
      "staticFeatureRecords": 4,
      "predicted": 0,
      "unsupported": 4,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "navigation",
      "records": 4,
      "staticFeatureRecords": 4,
      "predicted": 0,
      "unsupported": 4,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "searchbox",
      "records": 3,
      "staticFeatureRecords": 3,
      "predicted": 0,
      "unsupported": 3,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "spinbutton",
      "records": 3,
      "staticFeatureRecords": 3,
      "predicted": 0,
      "unsupported": 3,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "status",
      "records": 1,
      "staticFeatureRecords": 1,
      "predicted": 0,
      "unsupported": 1,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "textbox",
      "records": 52,
      "staticFeatureRecords": 52,
      "predicted": 0,
      "unsupported": 52,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "tooltip",
      "records": 2,
      "staticFeatureRecords": 2,
      "predicted": 0,
      "unsupported": 2,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    },
    {
      "at": "voiceover",
      "role": "unknown",
      "records": 1086,
      "staticFeatureRecords": 0,
      "predicted": 0,
      "unsupported": 1086,
      "exactMatches": 0,
      "mismatches": 0,
      "tokenBagAgreement": 0,
      "coverageOverAll": 0.0,
      "exactOverAll": 0.0,
      "exactAmongPredicted": null
    }
  ]
} as const;

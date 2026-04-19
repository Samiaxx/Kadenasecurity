(define-keyset 'fraud-case-admin (read-keyset 'fraud-case-admin))

(module fraud-case-registry 'fraud-case-admin
  "Hybrid fraud tracing registry anchored on Kadena."

  (defschema case
    case-id:string
    title:string
    seed:string
    chain:string
    created:time
    metadata-hash:string
    reporter:string)

  (defschema report
    report-id:string
    case-id:string
    wallet:string
    chain:string
    incident:object
    created:time
    metadata-hash:string
    reporter:string)

  (defschema attestation
    attest-id:string
    wallet:string
    chain:string
    risk-score:integer
    flags:[string]
    created:time
    attestor:string)

  (defschema audit-event
    event-id:string
    kind:string
    ref-id:string
    created:time
    details:object)

  (deftable cases:{case})
  (deftable reports:{report})
  (deftable attestations:{attestation})
  (deftable audit-events:{audit-event})

  (defun register-case
    (case-id:string title:string seed:string chain:string metadata-hash:string reporter:string)
    (enforce (!= case-id "") "case-id required")
    (enforce (!= title "") "title required")
    (enforce (!= seed "") "seed required")
    (insert cases case-id
      { "case-id": case-id
      , "title": title
      , "seed": seed
      , "chain": chain
      , "created": (at 'block-time (chain-data))
      , "metadata-hash": metadata-hash
      , "reporter": reporter
      })
    (record-audit "case" case-id
      { "title": title, "chain": chain, "seed": seed }))

  (defun submit-report
    (report-id:string case-id:string wallet:string chain:string incident:object metadata-hash:string reporter:string)
    (enforce (!= report-id "") "report-id required")
    (enforce (!= case-id "") "case-id required")
    (enforce (!= wallet "") "wallet required")
    (insert reports report-id
      { "report-id": report-id
      , "case-id": case-id
      , "wallet": wallet
      , "chain": chain
      , "incident": incident
      , "created": (at 'block-time (chain-data))
      , "metadata-hash": metadata-hash
      , "reporter": reporter
      })
    (record-audit "report" report-id
      { "case-id": case-id, "wallet": wallet, "chain": chain }))

  (defun attest-wallet
    (attest-id:string wallet:string chain:string risk-score:integer flags:[string] attestor:string)
    (enforce (!= attest-id "") "attest-id required")
    (enforce (!= wallet "") "wallet required")
    (enforce (>= risk-score 0) "risk-score >= 0")
    (enforce (<= risk-score 100) "risk-score <= 100")
    (insert attestations attest-id
      { "attest-id": attest-id
      , "wallet": wallet
      , "chain": chain
      , "risk-score": risk-score
      , "flags": flags
      , "created": (at 'block-time (chain-data))
      , "attestor": attestor
      })
    (record-audit "attestation" attest-id
      { "wallet": wallet, "chain": chain, "risk-score": risk-score }))

  (defun get-case (case-id:string)
    (read cases case-id))

  (defun get-report (report-id:string)
    (read reports report-id))

  (defun get-attestation (attest-id:string)
    (read attestations attest-id))

  (defun list-audit ()
    (select audit-events (constantly true)))

  (defun record-audit (kind:string ref-id:string details:object)
    (insert audit-events ref-id
      { "event-id": ref-id
      , "kind": kind
      , "ref-id": ref-id
      , "created": (at 'block-time (chain-data))
      , "details": details
      }))
)

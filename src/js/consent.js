(function () {
  'use strict'

  var policyUrl = 'https://www.iubenda.com/privacy-policy/35923895'
  var consentCookieName = 'dgs_cookie_consent'
  var consentRevision = 1

  function getCookieValue(name) {
    var prefix = name + '='
    var cookie = document.cookie.split(';').find(function (item) {
      return item.trim().indexOf(prefix) === 0
    })

    return cookie ? cookie.trim().slice(prefix.length) : null
  }

  function isIsoTimestamp(value) {
    if (typeof value !== 'string') {
      return false
    }

    var date = new Date(value)
    return Number.isFinite(date.getTime()) && date.toISOString() === value
  }

  function isKnownConsentPreference(value) {
    try {
      var preference = JSON.parse(decodeURIComponent(value))
      var allowedCategories = ['necessary', 'analytics']
      var allowedServiceCategories = ['necessary', 'analytics']
      var categoriesAreKnown = Array.isArray(preference.categories)
        && preference.categories.indexOf('necessary') !== -1
        && preference.categories.length === new Set(preference.categories).size
        && preference.categories.every(function (category) {
          return allowedCategories.indexOf(category) !== -1
        })
      var servicesAreStructured = preference.services
        && typeof preference.services === 'object'
        && !Array.isArray(preference.services)
      var serviceCategories = servicesAreStructured
        ? Object.keys(preference.services)
        : []
      var servicesAreKnown = servicesAreStructured
        && serviceCategories.length === allowedServiceCategories.length
        && serviceCategories.every(function (category) {
          return allowedServiceCategories.indexOf(category) !== -1
          && Array.isArray(preference.services[category])
          && preference.services[category].length === 0
        })
      var revisionIsCurrent = preference.revision === consentRevision
      var consentIdIsValid = typeof preference.consentId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(preference.consentId)
      var consentTimestampIsValid = isIsoTimestamp(preference.consentTimestamp)
      var lastConsentTimestampIsValid = isIsoTimestamp(preference.lastConsentTimestamp)
      var expirationIsValid = typeof preference.expirationTime === 'number'
        && Number.isFinite(preference.expirationTime)
        && preference.expirationTime > Date.now()

      return categoriesAreKnown
        && servicesAreKnown
        && revisionIsCurrent
        && consentIdIsValid
        && consentTimestampIsValid
        && lastConsentTimestampIsValid
        && expirationIsValid
    } catch (error) {
      return false
    }
  }

  function discardUnknownConsentPreference() {
    var value = getCookieValue(consentCookieName)

    if (value && !isKnownConsentPreference(value)) {
      document.cookie = consentCookieName + '=; Max-Age=0; Path=/; SameSite=Lax'
    }
  }

  function initializeVideos() {
    var manager = window.iframemanager()

    manager.run({
      currLang: 'en',
      services: {
        youtube: {
          embedUrl: 'https://www.youtube-nocookie.com/embed/{data-id}',
          thumbnailUrl: '/images/video-placeholder.svg',
          iframe: {
            allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen',
            loading: 'lazy'
          },
          languages: {
            en: {
              notice: 'Loading this video will contact YouTube.',
              loadBtn: 'Load video'
            }
          }
        }
      }
    })
  }

  function initializeConsent() {
    window.CookieConsent.run({
      mode: 'opt-in',
      revision: consentRevision,
      hideFromBots: false,
      disablePageInteraction: false,
      cookie: {
        name: consentCookieName,
        expiresAfterDays: 180,
        sameSite: 'Lax'
      },
      guiOptions: {
        consentModal: {
          layout: 'bar inline',
          position: 'bottom',
          equalWeightButtons: true,
          flipButtons: false
        },
        preferencesModal: {
          layout: 'box',
          equalWeightButtons: true,
          flipButtons: false
        }
      },
      categories: {
        necessary: {
          enabled: true,
          readOnly: true
        },
        analytics: {
          enabled: false,
          readOnly: false,
          autoClear: {
            cookies: [
              {
                name: /^_ga/
              }
            ],
            reloadPage: true
          }
        }
      },
      language: {
        default: 'en',
        translations: {
          en: {
            consentModal: {
              title: 'Privacy choices',
              description: 'We use necessary technologies to operate this website. With your permission, we also use Google Analytics to understand site usage. Analytics stays off unless you allow it. You can change your choice anytime through Analytics Preferences.',
              acceptAllBtn: 'Allow analytics',
              acceptNecessaryBtn: 'Reject analytics',
              showPreferencesBtn: 'Manage preferences',
              footer: '<a href="' + policyUrl + '" target="_blank" rel="noopener noreferrer">Privacy Policy</a>'
            },
            preferencesModal: {
              title: 'Analytics preferences',
              acceptAllBtn: 'Allow analytics',
              acceptNecessaryBtn: 'Reject analytics',
              savePreferencesBtn: 'Save preferences',
              closeIconLabel: 'Close analytics preferences',
              sections: [
                {
                  title: 'Your analytics choice',
                  description: 'Choose whether DelGrossos.com may use Google Analytics. Essential website operation remains available either way.'
                },
                {
                  title: 'Essential',
                  description: 'Required to remember your privacy choice and operate the website.',
                  linkedCategory: 'necessary'
                },
                {
                  title: 'Analytics',
                  description: 'Google Analytics helps us understand how visitors use the website. It remains off unless you allow it.',
                  linkedCategory: 'analytics'
                },
                {
                  title: 'More information',
                  description: '<a href="' + policyUrl + '" target="_blank" rel="noopener noreferrer">Read our Privacy Policy</a>.'
                }
              ]
            }
          }
        }
      }
    })
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-cc="show-preferencesModal"]')) {
      window.CookieConsent.showPreferences()
    }
  }, true)

  discardUnknownConsentPreference()
  initializeConsent()
  initializeVideos()
}())

import CardManager from './h5p-dialogcards-card-manager';
import SummaryScreen from './h5p-dialogcards-summary-screen';

const $ = H5P.jQuery;
const JoubelUI = H5P.JoubelUI;

class Dialogcards extends H5P.EventDispatcher {
  /**
   * Initialize module.
   *
   * @constructor
   *
   * @param {Object} params Parameters.
   * @param {Number} id Content id.
   * @param {Object} contentData Content data, e.g. for saveContentState
   * @returns {DialogCards} self
   */
  constructor(params, id, contentData) {
    Dialogcards.idCounter++;
    super();

    this.contentId = this.id = id;
    this.previousState = contentData.previousState || {};

    // Var cardOrder stores order of cards to allow resuming of card set.
    // Var progress stores current card index.
    this.contentData = contentData || {};

    // Strip cards with empty sides
    params.dialogs = params.dialogs || [];
    params.dialogs = params.dialogs.filter(dialog => {
      if (!dialog.front || !dialog.back) {
        return false;
      }

      // Empty front?
      if (!dialog.front.text && !dialog.front.image && !dialog.front.audio) {
        return false;
      }

      // Empty back?
      const noBackText = !dialog.back.text;
      const noBackImage = ((dialog.back.useImageFromFront && !dialog.front.image) || (!dialog.back.useImageFromFront && !dialog.back.image));
      const noBackAudio = ((dialog.back.useAudioFromFront && !dialog.front.audio) || (!dialog.back.useAudioFromFront && !dialog.back.audio));
      if (noBackText && noBackImage && noBackAudio) {
        return false;
      }

      return true;
    });

    // Set default behavior.
    this.params = $.extend(true, {
      title: '',
      mode: 'normal',
      description: "Sit in pairs and make up sentences where you include the expressions below.<br/>Example: I should have said yes, HOWEVER I kept my mouth shut.",
      next: "Next",
      prev: "Previous",
      retry: "Retry",
      answer: "Turn",
      correctAnswer: 'I got it right!',
      incorrectAnswer: 'I got it wrong',
      round: 'Round @round',
      cardsLeft: 'Cards left: @number',
      nextRound: 'Proceed to round @round',
      startOver: 'Start over',
      showSummary: 'Next',
      summary: 'Summary',
      summaryCardsRight: 'Cards you got right:',
      summaryCardsWrong: 'Cards you got wrong:',
      summaryCardsNotShown: 'Cards in pool not shown:',
      summaryOverallScore: 'Overall Score',
      summaryCardsCompleted: 'Cards you have completed learning:',
      summaryCompletedRounds: 'Completed rounds:',
      summaryAllDone: 'Well done! You got all @cards cards correct @max times in a row each!',
      progressText: "Card @card of @total",
      cardFrontLabel: "Card front",
      cardBackLabel: "Card back",
      tipButtonLabel: 'Show tip',
      audioNotSupported: 'Your browser does not support this audio',
      confirmStartingOver: {
        header: 'Start over?',
        body: 'All progress will be lost. Are you sure you want to start over?',
        cancelLabel: 'Cancel',
        confirmLabel: 'Start over'
      },
      dialogs: [
        {
          front: {
            text: 'Horse'
          },
          back: {
            text: 'Hest',
            useImageFromFront: true,
            useAudioFromFront: false
          }
        }
        // {
        //   front: {
        //     text: 'Cow'
        //   },
        //   back: {
        //     text: 'Ku',
        //     useImageFromFront: true,
        //     useAudioFromFront: false
        //   }
        // }
      ],
      behaviour: {
        enableRetry: true,
        disableBackwardsNavigation: false,
        scaleTextNotCard: false,
        randomCards: false,
        maxProficiency: 5,
        quickProgression: false
      }
    }, params);

    // Check for no texts at all
    this.hasNoTexts = this.params.dialogs.every(dialog => dialog.front.text === '' && dialog.back.text === '');

    // Check for no audios at all
    this.hasNoAudios = !this.params.dialogs.some(dialog => dialog.front.audio || (dialog.back.audio && !dialog.back.useAudioFromFront));

    // TODO: Translations

    this.cards = [];

    this.currentCardId = 0;
    this.round = 0; // 0 indicates that DOM needs to be set up
    this.results = this.previousState.results || [];

    // Workaround for iOS
    if (screen.orientation) {
      screen.orientation.addEventListener('change', () => {
        this.handleOrientationChange();
      });
    }
    else {
      window.addEventListener('orientationchange', () => {
        this.handleOrientationChange();
      });
    }

    /*
     * Workaround (hopefully temporary) for KidsLoopLive that for whatever
     * reason does not use h5p-resizer.js.
     */
    window.addEventListener('resize', () => {
      this.resize();
    });

    /**
     * Attach h5p inside the given container.
     *
     * @param {jQuery} $container Container.
     */
    this.attach = ($container) => {
      this.$inner = $container.addClass('h5p-dialogcards');
      if (this.params.behaviour.scaleTextNotCard) {
        $container.addClass('h5p-text-scaling');
      }

      // KidsLoop customization to prevent dragging the image
      this.$inner.get(0).addEventListener('dragstart', function (event) {
        event.preventDefault();
      });

      // Only pass what's necessary
      const managerParams = {
        mode: this.params.mode,
        dialogs: this.params.dialogs,
        audioNotSupported: this.params.audioNotSupported,
        answer: this.params.answer,
        showSummary: this.params.showSummary,
        incorrectAnswer: this.params.incorrectAnswer,
        correctAnswer: this.params.correctAnswer,
        progressText: this.params.progressText,
        tipButtonLabel: this.params.tipButtonLabel,
        behaviour: {
          scaleTextNotCard: this.params.behaviour.scaleTextNotCard,
          maxProficiency: this.params.behaviour.maxProficiency,
          quickProgression: this.params.behaviour.quickProgression
        },
        cardPiles: this.previousState.cardPiles
      };

      this.cardManager = new CardManager(managerParams, this.id, {
        onCardTurned: this.handleCardTurned,
        onNextCard: this.nextCard
      });

      this.createDOM(this.round === 0);

      /*
       * Goto previously viewed card. It was possible to also recover the turned
       * state, but it feels sensible to let the previously viewed card be
       * reviewed starting with the front.
       */
      if (this.previousState.currentCardId !== undefined) {
        this.gotoCard(this.previousState.currentCardId);

        // Show summary if previous round was completed but next round not started.
        if (this.params.mode === 'repetition' && this.results.length === this.cardIds.length) {
          this.showSummary(true);
        }
      }

      this.updateNavigation();
      this.trigger('resize');
    };

    /**
     * Create DOM.
     * @param {boolean} firstCall Is first call?
     */
    this.createDOM = (firstCall) => {
      this.cardIds = (firstCall && this.previousState.cardIds) ?
        this.previousState.cardIds :
        this.cardManager.createSelection();

      this.cardPoolSize = this.cardPoolSize || this.cardManager.getSize();

      if (firstCall === true) {
        const title = $('<div>' + this.params.title + '</div>').text().trim();
        this.$header = $((title ? '<div class="h5p-dialogcards-title"><div class="h5p-dialogcards-title-inner">' + this.params.title + '</div></div>' : '') +
          '<div class="h5p-dialogcards-description">' + this.params.description + '</div>');

        this.summaryScreen = new SummaryScreen(this.params, {nextRound: this.nextRound, retry: this.restartRepetition});
      }

      if (firstCall === true) {
        this.$cardwrapperSet = this.initCards(this.cardIds);
      }
      else {
        this.$cardwrapperSet.detach();
        this.$cardwrapperSet = this.initCards(this.cardIds);
        this.$cardSideAnnouncer.before(this.$cardwrapperSet);
      }

      this.$cardwrapperSet.prepend(this.summaryScreen.getDOM());

      if (firstCall === true) {
        this.$cardSideAnnouncer = $('<div>', {
          html: this.params.cardFrontLabel,
          'class': 'h5p-dialogcards-card-side-announcer',
          'aria-live': 'polite',
          'aria-hidden': 'true'
        });

        this.$footer = this.createFooter();

        this.$mainContent = $('<div>')
          .append(this.$header)
          .append(this.$cardwrapperSet)
          .append(this.$cardSideAnnouncer)
          .append(this.$footer)
          .appendTo(this.$inner);

        // No card has texts
        if (this.hasNoTexts) {
          this.cards.forEach(card => {
            card.setNoText();
          });
        }

        this.on('reset', function () {
          this.reset();
        });

        this.on('resize', this.resize);

        // Set round to previous state if available
        this.round = (this.previousState.round !== undefined) ? this.previousState.round : 1;
      }
    };

    /**
     * Create footer/navigation line
     *
     * @returns {*|jQuery|HTMLElement} Footer element
     */
    this.createFooter = () => {
      const $footer = $('<nav>', {
        'class': 'h5p-dialogcards-footer',
        'role': 'navigation'
      });

      if (this.params.mode === 'normal') {
        this.$prev = JoubelUI.createButton({
          'class': 'h5p-dialogcards-footer-button h5p-dialogcards-prev truncated',
          'aria-label': this.params.prev,
          'title': this.params.prev
        }).click(() => {
          this.prevCard();
        }).appendTo($footer);

        this.$next = JoubelUI.createButton({
          'class': 'h5p-dialogcards-footer-button h5p-dialogcards-next truncated',
          'aria-label': this.params.next,
          'title': this.params.next
        }).click(() => {
          this.nextCard();
        }).appendTo($footer);

        this.$retry = JoubelUI.createButton({
          'class': 'h5p-dialogcards-footer-button h5p-dialogcards-retry h5p-dialogcards-disabled',
          'title': this.params.retry,
          'html': this.params.retry
        }).click(() => {
          this.trigger('reset');
        }).appendTo($footer);

        this.$progress = $('<div>', {
          'id': 'h5p-dialogcards-progress-' + Dialogcards.idCounter,
          'class': 'h5p-dialogcards-progress',
          'aria-live': 'assertive'
        }).appendTo($footer);
      }
      else {
        this.$round = $('<div>', {
          'class': 'h5p-dialogcards-round'
        }).appendTo($footer);

        this.$progress = $('<div>', {
          'class': 'h5p-dialogcards-cards-left',
          'aria-live': 'assertive'
        }).appendTo($footer);
      }

      return $footer;
    };

    /**
     * Called when all cards has been loaded.
     */
    this.updateImageSize = () => {
      // Find highest card content
      let relativeHeightCap = 15;
      let height = 0;

      const $currentCardContent = this.cards[this.currentCardId].getDOM().find('.h5p-dialogcards-card-content');

      this.params.dialogs.forEach(dialog => {
        let imageHeight;

        if (dialog.front.image) {
          imageHeight = dialog.front.image.height / dialog.front.image.width * $currentCardContent.get(0).getBoundingClientRect().width;
          if (imageHeight > height) {
            height = imageHeight;
          }
        }

        if (dialog.back.image) {
          imageHeight = dialog.back.image.height / dialog.back.image.width * $currentCardContent.get(0).getBoundingClientRect().width;
          if (imageHeight > height) {
            height = imageHeight;
          }
        }
      });

      if (height > 0) {
        let relativeImageHeight = height / parseFloat(this.$inner.css('font-size'));
        if (relativeImageHeight > relativeHeightCap) {
          relativeImageHeight = relativeHeightCap;
        }
        this.cards.forEach(card => {
          card.setImageHeight(`${relativeImageHeight}em`);
        });
      }
    };

    /**
     * Creates all cards and appends them to card wrapper.
     *
     * @param {object[]} cardIds Card ids.
     * @returns {*|jQuery|HTMLElement} Card wrapper set
     */
    this.initCards = (cardIds) => {
      const initLoad = 2;
      this.cards = [];
      this.currentCardId = 0;

      // Randomize cards order
      if (this.params.behaviour.randomCards) {
        cardIds = H5P.shuffleArray(cardIds);
      }

      const $cardwrapperSet = $('<div>', {
        'class': 'h5p-dialogcards-cardwrap-set'
      });

      for (let i = 0; i < cardIds.length; i++) {
        // Load cards progressively
        if (i >= initLoad) {
          break;
        }

        const card = this.getCard(cardIds[i]);
        card.setProgressText(i + 1, cardIds.length);

        this.cards.push(card);
        const $cardWrapper = card.getDOM();

        // Set current card
        if (i === this.currentCardId) {
          $cardWrapper.addClass('h5p-dialogcards-current');
          this.$current = $cardWrapper;
        }

        card.addTipToCard($cardWrapper.find('.h5p-dialogcards-card-content'), 'front', i);

        $cardwrapperSet.append($cardWrapper);
      }

      return $cardwrapperSet;
    };

    /**
     * Handle card turned.
     *
     * @param {boolean} turned - True, if card is turned.
     */
    this.handleCardTurned = (turned) => {
      // a11y notification
      this.$cardSideAnnouncer.html(turned ? this.params.cardFrontLabel : this.params.cardBackLabel);

      // retry button
      if (this.params.behaviour.enableRetry && this.currentCardId + 1 === this.cardIds.length) {
        if (this.$retry) {
          this.$retry.removeClass('h5p-dialogcards-disabled');
          this.truncateRetryButton();
        }
      }
    };

    /**
     * Update navigation text and show or hide buttons.
     */
    this.updateNavigation = () => {
      if (this.params.mode === 'normal') {
        // Final card
        if (this.getCurrentSelectionIndex() < this.cardIds.length - 1) {
          this.$next.removeClass('h5p-dialogcards-disabled');
          this.$retry.addClass('h5p-dialogcards-disabled');
        }
        else {
          this.$next.addClass('h5p-dialogcards-disabled');
        }

        // First card
        if (this.currentCardId > 0 && !this.params.behaviour.disableBackwardsNavigation) {
          this.$prev.removeClass('h5p-dialogcards-disabled');
        }
        else {
          this.$prev.addClass('h5p-dialogcards-disabled');
        }

        this.$progress.text(this.params.progressText
          .replace('@card', this.getCurrentSelectionIndex() + 1)
          .replace('@total', this.cardIds.length)
        );

        // Looks strange, but the Ids get mixed up elsewhere
        this.cards[this.findCardPosition(this.cards[this.currentCardId].id)].resizeOverflowingText();
      }
      else {
        this.$round.text(this.params.round.replace('@round', this.round));
        const selectionIndex = this.getCurrentSelectionIndex();
        this.$progress.text(this.params.cardsLeft.replace('@number', this.cardIds.length - selectionIndex));
      }

      this.trigger('resize');
    };

    /**
     * Show summary screen.
     * @param {boolean} [previousState = false] If true, piles will not be updated.
     */
    this.showSummary = (previousState = false) => {
      // Update piles and retrieve the new pile sizes
      const newPileSizes = (previousState) ?
        this.cardManager.getPileSizes() :
        this.cardManager.updatePiles(this.results);

      const right = this.results.filter(result => result.result === true).length;
      const wrong = this.results.length - right;
      const notShown = this.cardPoolSize - right - wrong;
      const completed = newPileSizes.slice(-1)[0];
      const done = completed === this.cardPoolSize;

      const summary = {
        round: this.round,
        results: [
          {
            field: 'h5p-dialogcards-round-cards-right',
            score: {value: right, max: wrong + right}
          },
          {
            field: 'h5p-dialogcards-round-cards-wrong',
            score: {value: wrong, max: wrong + right}
          },
          {
            field: 'h5p-dialogcards-round-cards-not-shown',
            score: {value: notShown}
          },
          {
            field: 'h5p-dialogcards-overall-cards-completed',
            score: {value: completed, max: this.cardPoolSize}
          },
          {
            field: 'h5p-dialogcards-overall-completed-rounds',
            score: {value: this.round}
          }
        ]
      };

      if (done) {
        summary.done = true;
        summary.message = this.params.summaryAllDone
          .replace('@cards', this.cardPoolSize)
          .replace('@max', this.params.behaviour.maxProficiency - 1);
      }

      this.summaryScreen.update(summary);
      this.summaryScreen.show();
      this.hideCards();

      this.trigger('resize');
    };

    /**
     * Show main content.
     */
    this.showCards = () => {
      this.$cardwrapperSet.find('.h5p-dialogcards-cardwrap').removeClass('h5p-dialogcards-gone');
      this.$footer.removeClass('h5p-dialogcards-gone');
      this.cardsShown = true;
    };

    /**
     * Hide main content.
     */
    this.hideCards = () => {
      this.$cardwrapperSet.find('.h5p-dialogcards-cardwrap').addClass('h5p-dialogcards-gone');
      this.$footer.addClass('h5p-dialogcards-gone');
      this.cardsShown = false;
    };

    /**
     * Show next card.
     *
     * @param {object} [result] Optional result of repetition mode.
     */
    this.nextCard = (result) => {
      const currentId = this.getCurrentSelectionIndex()

      if (typeof(result) !== 'undefined') {
        this.results.push(result);

        // Emit screenshot
        if (H5P && H5P.KLScreenshot) {
          // Make hover hightlight permanent for screenshot
          this.cards[this.currentCardId].highlightButton(result.result ? 'correct' : 'incorrect', true);

          H5P.KLScreenshot.takeScreenshot(
            {
              subContentId: this.params.dialogs[currentId].front.subContentId,
              getTitle: () => {
                return this.params.progressText
                  .replace('@card', currentId + 1)
                  .replace('@total', this.params.dialogs.length);
              },
              trigger: this.trigger
            },
            this.$inner.get(0)
          );
        }
      }

      // Remove hover hightlight that was required for for screenshot
      this.cards[this.currentCardId].highlightButton('correct', false);
      this.cards[this.currentCardId].highlightButton('incorrect', false);

      this.cards[this.currentCardId].stopAudio();

      // On final card
      if (this.cardIds.length - currentId === 1) {
        if (this.params.mode === 'repetition') {
          this.$progress.text(this.params.cardsLeft.replace('@number', 0));
          this.cards[this.currentCardId].showSummaryButton(this.showSummary);
        }
        return;
      }

      this.gotoCard(currentId + 1);
    };

    /**
     * Get card from card manager.
     * @param {number} id Card's Id.
     * @return {object} Card.
     */
    this.getCard = (id) => {
      const card = this.cardManager.getCard(id);
      card.createButtonListeners();

      return card;
    };

    /**
     * Find the position of a loaded card.
     * @param {number} cardId CardId to look for.
     * @return {number} Position or undefined.
     */
    this.findCardPosition = (cardId) => {
      let position;

      this.cards.forEach((card, index) => {
        if (!position && card.id === cardId) {
          position = index;
        }
      });

      return position;
    };

    /**
     * Insert a card into the DOM.
     * @param {Card} card Card to insert.
     * @param {number} [index] Position to insert card at.
     */
    this.insertCardToDOM = (card, index) => {
      const $node = card.getDOM();

      // Put at appropriate position.
      if (index === undefined) {
        $node.appendTo(this.$cardwrapperSet);
      }
      else if (index === 0) {
        this.$cardwrapperSet.prepend($node);
      }
      else {
        this.$cardwrapperSet.children().eq(index).after($node);
      }

      // Add hints
      card.addTipToCard($node.find('.h5p-dialogcards-card-content'), 'front', index);
    };

    /**
     * Go to a specific card in the selection. Cards may need to be loaded.
     * @param {number} targetPosition Target card position.
     */
    this.gotoCard = (targetPosition) => {
      if (targetPosition < 0 || targetPosition >= this.cardIds.length) {
        return;
      }

      // Stop action on current card
      const currentCard = this.cards[this.currentCardId];
      currentCard.stopAudio();
      currentCard.getDOM().removeClass('h5p-dialogcards-current');

      // Get card positions to check for being loaded
      const checkLoaded = [];
      if (targetPosition > 0) {
        checkLoaded.push(targetPosition - 1);
      }
      checkLoaded.push(targetPosition);
      if (targetPosition + 1 < this.cardIds.length) {
        checkLoaded.push(targetPosition + 1);
      }

      // Load and insert target card, predecessor and successor if required.
      checkLoaded.forEach(position => {
        const loadedPosition = this.findCardPosition(this.cardIds[position]);
        if (loadedPosition === undefined) {

          // Card has not been loaded. Load now.
          const card = this.getCard(this.cardIds[position]);
          card.setProgressText(position + 1, this.cardIds.length);

          /*
           * Try to find successor card in loaded pile and insert before
           * or put to the end of the loaded pile.
           */
          const successorId = Math.min(position + 1, this.cardIds.length - 1);
          const successor = this.findCardPosition(this.cardIds[successorId]);
          const insertPosition = successor || this.cards.length;

          this.cards.splice(insertPosition, 0, card);
          this.insertCardToDOM(card, insertPosition);
        }
      });

      this.resize();

      // Retrieve position of id now in *loaded cards*
      targetPosition = this.findCardPosition(this.cardIds[targetPosition]);

      // Set classes for card order/display
      this.cards.forEach((card, index) => {
        if (index < targetPosition) {
          card.getDOM().addClass('h5p-dialogcards-previous');
        }
        else {
          card.getDOM().removeClass('h5p-dialogcards-previous');

          if (index === targetPosition) {
            card.getDOM().addClass('h5p-dialogcards-current');
          }
        }
      });

      this.currentCardId = targetPosition;
      this.updateNavigation();
      this.cards[this.currentCardId].setCardFocus();
    };

    /**
     * Show previous card.
     */
    this.prevCard = () => {
      this.gotoCard(this.getCurrentSelectionIndex() - 1);
    };

    /**
     * Show all audio buttons
     */
    this.showAllAudio = () => {
      this.$cardwrapperSet.find('.h5p-audio-inner')
        .removeClass('hide');
    };

    this.restartRepetition = () => {
      this.cardManager.reset();
      this.round = 0;

      this.nextRound();
    };

    this.nextRound = () => {
      this.round++;
      this.summaryScreen.hide();
      this.showCards();

      this.reset();
      this.createDOM();

      this.updateNavigation();
      this.cards[this.currentCardId].setCardFocus(true);

      this.trigger('resize');
    };

    /**
     * Reset the task so that the user can do it again.
     */
    this.reset = () => {
      this.results = [];
      this.cards[this.currentCardId].stopAudio(this.$current.index());

      // Turn all cards to front
      this.cards.forEach(card => {
        card.reset();
      });

      // Show first card
      this.currentCardId = 0;
      if (this.params.mode === 'normal') {
        this.cards[this.currentCardId].getDOM().addClass('h5p-dialogcards-current');
      }
      this.updateNavigation();

      if (this.$retry) {
        this.$retry.addClass('h5p-dialogcards-disabled');
      }
      this.showAllAudio();

      this.cards[this.currentCardId].resizeOverflowingText();
      this.cards[this.currentCardId].setCardFocus();
    };

    /**
     * Update the dimensions of the task when resizing the task.
     */
    this.resize = () => {
      this.handleOrientationChange();

      let displayLimits = null;

      const titleHeight = this.$inner.find('.h5p-dialogcards-title').outerHeight() || 0;
      const descriptionHeight = this.$inner.find('.h5p-dialogcards-description').outerHeight(true) || 0;
      const footerHeight = this.$footer.outerHeight() || 0;

      const nonCardHeight = titleHeight + descriptionHeight + footerHeight;

      const isMobileLandscape = this.isMobileLandscape();

      // Change landscape layout on mobile
      if (
        typeof window.orientation === 'number' &&
        this.$cardwrapperSet.find('.h5p-dialogcards-summary-screen').hasClass('h5p-dialogcards-gone') &&
        this.params.behaviour.scaleTextNotCard
      ) {
        this.$inner.toggleClass('h5p-landscape', isMobileLandscape);

        if (isMobileLandscape) {
          displayLimits = (this.isRoot()) ? this.computeDisplayLimitsKLL() : null;

          const screenHeight = (this.isIOS() && isMobileLandscape) ?
            screen.width :
            screen.height;

          if (displayLimits?.height === 1) {
            displayLimits.height = screenHeight;
          }

          if (displayLimits?.height) {
            this.$cardwrapperSet.css('max-height', `${displayLimits.height - nonCardHeight}px`);
          }
          else {
            this.$cardwrapperSet.css('max-height', '');
          }
        }
      }
      else {
        this.$cardwrapperSet.css('max-height', '');
      }

      let maxHeight = 0;

      if (!displayLimits || !isMobileLandscape || !this.params.behaviour.scaleTextNotCard) {
        this.updateImageSize();
      }
      else {
        this.cards.forEach(card => {
          card.setImageHeight('');
        });
      }

      if (!this.params.behaviour.scaleTextNotCard && this.cardsShown !== false) {
        this.determineCardSizes();
      }

      if (!this.params.behaviour.scaleTextNotCard || !isMobileLandscape || !displayLimits?.height || !this.$cardwrapperSet.find('.h5p-dialogcards-summary-screen').hasClass('h5p-dialogcards-gone')) {
        // Reset card-wrapper-set height
        this.$cardwrapperSet.css('height', 'auto');

        // Find max required height for all cards
        this.$cardwrapperSet.children(':not(.h5p-dialogcards-gone)').each( function () {
          const wrapperHeight = $(this).css('height', 'initial').outerHeight();
          $(this).css('height', 'inherit');
          maxHeight = Math.max(wrapperHeight, maxHeight);

          // Check height
          if (!$(this).next('.h5p-dialogcards-cardwrap').length) {
            const initialHeight = $(this).find('.h5p-dialogcards-cardholder').css('height', 'initial').outerHeight();
            maxHeight = Math.max(initialHeight, maxHeight);
            $(this).find('.h5p-dialogcards-cardholder').css('height', 'inherit');
          }
        });

        /*
         * The original implementation used relative heights in em, but
         * within the KidsLoop app, the webview disrespects the font size
         * that is specified.
         */
        this.$cardwrapperSet.css('height', `${maxHeight}px`);
      }
      else {
        if (displayLimits?.height - nonCardHeight > 1) {
          this.$cardwrapperSet.css('height', `${displayLimits?.height - nonCardHeight}px`);
        }
      }

      this.scaleToFitHeight();
      this.truncateRetryButton();

      this.cards[this.currentCardId].resizeOverflowingText();
    };

    /**
     * Resizes each card to fit its text
     */
    this.determineCardSizes = () => {
      const self = this;

      if (this.cardSizeDetermined === undefined) {
        // Keep track of which cards we've already determined size for
        this.cardSizeDetermined = [];
      }

      // Go through each card
      this.$cardwrapperSet.children(':visible').each(function (i) {
        const cardId = self.cards[i].id;

        if (self.cardSizeDetermined.indexOf(cardId) !== -1) {
          return; // Already determined, no need to determine again.
        }
        self.cardSizeDetermined.push(cardId);

        // Here "this" references the jQuery object
        const $content = $('.h5p-dialogcards-card-content', this);
        const $text = $('.h5p-dialogcards-card-text-inner-content', $content);

        // Grab size with text
        const textHeight = $text[0].getBoundingClientRect().height;

        // Change to answer
        const currentCard = self.cards[i];
        currentCard.changeText(currentCard.getAnswer());

        // Grab size with answer
        const answerHeight = $text[0].getBoundingClientRect().height;

        // Use highest
        let useHeight = (textHeight > answerHeight ? textHeight : answerHeight);

        // Min. limit
        const minHeight = parseFloat($text.parent().parent().css('minHeight'));
        if (useHeight < minHeight) {
          useHeight =  minHeight;
        }

        // None of the cards has text, shrink text area, leave space for audio
        if (self.hasNoTexts) {
          const $cardText = $text.find('.h5p-dialogcards-card-text');
          useHeight = self.hasNoAudios ? 0 : useHeight - parseFloat($cardText.css('height'));
          $cardText.css('height', 0);
        }

        // Convert to em
        const fontSize = parseFloat($content.css('fontSize'));
        useHeight /= fontSize;

        // Set height
        $text.parent().css('height', useHeight + 'em');

        // Change back to text
        currentCard.changeText(currentCard.getText());
      });
    };

    /**
     * Scales the card contents.
     */
    this.scaleToFitHeight = () => {
      if (!this.$cardwrapperSet || !this.$cardwrapperSet.is(':visible') || !this.params.behaviour.scaleTextNotCard) {
        return;
      }

      // Resize font size to fit inside CP
      if (this.$inner.parents('.h5p-course-presentation').length) {
        let $parentContainer = this.$inner.parent();
        if (this.$inner.parents('.h5p-popup-container').length) {
          $parentContainer = this.$inner.parents('.h5p-popup-container');
        }
        const containerHeight = $parentContainer.get(0).getBoundingClientRect().height;
        const getContentHeight = () => {
          let contentHeight = 0;
          this.$inner.children().each(function () {
            // Here "this" references the jQuery object
            const $child = $(this);
            contentHeight += this.getBoundingClientRect().height +
            parseFloat($child.css('margin-top')) + parseFloat($child.css('margin-bottom'));
          });
          return contentHeight;
        };
        let contentHeight = getContentHeight();
        const parentFontSize = parseFloat(this.$inner.parent().css('font-size'));
        let newFontSize = parseFloat(this.$inner.css('font-size'));

        // Decrease font size
        if (containerHeight < contentHeight) {
          while (containerHeight < contentHeight) {
            newFontSize -= Dialogcards.SCALEINTERVAL;

            // Cap at min font size
            if (newFontSize < Dialogcards.MINSCALE) {
              break;
            }

            // Set relative font size to scale with full screen.
            this.$inner.css('font-size', (newFontSize / parentFontSize) + 'em');
            contentHeight = getContentHeight();
          }
        }
        else { // Increase font size
          let increaseFontSize = true;
          while (increaseFontSize) {
            newFontSize += Dialogcards.SCALEINTERVAL;

            // Cap max font size
            if (newFontSize > Dialogcards.MAXSCALE) {
              increaseFontSize = false;
              break;
            }

            // Set relative font size to scale with full screen.
            let relativeFontSize = newFontSize / parentFontSize;
            this.$inner.css('font-size', relativeFontSize + 'em');
            contentHeight = getContentHeight();
            if (containerHeight <= contentHeight) {
              increaseFontSize = false;
              relativeFontSize = (newFontSize - Dialogcards.SCALEINTERVAL) / parentFontSize;
              this.$inner.css('font-size', relativeFontSize + 'em');
            }
          }
        }
      }
      else { // Resize mobile view
        this.cards[this.currentCardId].resizeOverflowingText();
      }
    };

    /**
     * Truncate retry button if width is small.
     */
    this.truncateRetryButton = () => {
      if (!this.$retry) {
        return;
      }

      // Reset button to full size
      this.$retry.removeClass('truncated');
      this.$retry.html(this.params.retry);

      // Measure button
      const maxWidthPercentages = 0.3;
      const retryWidth = this.$retry.get(0).getBoundingClientRect().width +
          parseFloat(this.$retry.css('margin-left')) + parseFloat(this.$retry.css('margin-right'));
      const retryWidthPercentage = retryWidth / this.$retry.parent().get(0).getBoundingClientRect().width;

      // Truncate button
      if (retryWidthPercentage > maxWidthPercentages) {
        this.$retry.addClass('truncated');
        this.$retry.html('');
      }
    };

    /**
     * Retrieve index of card in selection, not loaded cards.
     */
    this.getCurrentSelectionIndex = () => this.cardIds.indexOf(this.cards[this.currentCardId].id);

    /**
     * Get the content type title.
     *
     * @return {string} title.
     */
    this.getTitle = () => {
      return H5P.createTitle((this.contentData && this.contentData.metadata && this.contentData.metadata.title) ? this.contentData.metadata.title : 'Dialog Cards');
    };

    /**
     * Save the current state to be restored later.
     */
    this.getCurrentState = () => {
      return {
        cardPiles: this.cardManager.getPiles(),
        cardIds: this.cardIds,
        round: this.round,
        currentCardId: this.getCurrentSelectionIndex(),
        results: this.results
      };
    };
  }

  /**
   * Compute display limits.
   * @return {object|null} Height and width in px or null if cannot be determined.
   */
  computeDisplayLimits() {
    let topWindow = this.getTopWindow();

    // iOS doesn't change screen dimensions on rotation
    let screenSize = (this.isIOS() && this.getOrientation() === 'landscape') ?
      { height: screen.width, width: screen.height } :
      { height: screen.height, width: screen.width };

    topWindow = topWindow || {
      innerHeight: screenSize.height,
      innerWidth: screenSize.width
    };

    // Smallest value of viewport and container wins
    return {
      height: Math.min(topWindow.innerHeight, screenSize.height),
      width: Math.min(topWindow.innerWidth, this.$inner.get(0).offsetWidth)
    };
  }

  /**
   * Compute display limits for KidsLoop Live.
   * @return {object|null} Height and width in px or null if cannot be determined.
   */
  computeDisplayLimitsKLL() {
    const displayLimits = this.computeDisplayLimits();

    // This only works because KLL enforces height on H5P's iframe
    displayLimits.height = Math.min(displayLimits.height, document.body.offsetHeight);
    return displayLimits;
  }

  /**
   * Detect whether user is running iOS.
   * @return {boolean} True, if user is running iOS.
   */
  isIOS() {
    return (
      ['iPad Simulator', 'iPhone Simulator', 'iPod Simulator', 'iPad', 'iPhone', 'iPod'].includes(navigator.platform) ||
      (navigator.userAgent.includes('Mac') && 'ontouchend' in document)
    );
  }

  /**
   * Determine whether mobile device in landscape orientation.
   * @return {boolean} True, if mobile device in landscape orientation.
   */
  isMobileLandscape() {
    return this.isMobileDevice() && this.getOrientation() === 'landscape';
  }

  /**
   * Detect mobile devices (http://detectmobilebrowsers.com/)
   * @returns {boolean} True if running on a mobile device.
   */
  isMobileDevice() {
    let check = false;
    (function (a) {
      if (/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw-(n|u)|c55\/|capi|ccwa|cdm-|cell|chtm|cldc|cmd-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc-s|devi|dica|dmob|do(c|p)o|ds(12|-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(-|_)|g1 u|g560|gene|gf-5|g-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd-(m|p|t)|hei-|hi(pt|ta)|hp( i|ip)|hs-c|ht(c(-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i-(20|go|ma)|i230|iac( |-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|-[a-w])|libw|lynx|m1-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|-([1-8]|c))|phil|pire|pl(ay|uc)|pn-2|po(ck|rt|se)|prox|psio|pt-g|qa-a|qc(07|12|21|32|60|-[2-7]|i-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h-|oo|p-)|sdk\/|se(c(-|0|1)|47|mc|nd|ri)|sgh-|shar|sie(-|m)|sk-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h-|v-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl-|tdg-|tel(i|m)|tim-|t-mo|to(pl|sh)|ts(70|m-|m3|m5)|tx-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas-|your|zeto|zte-/i.test(a.substr(0, 4))) check = true;
    })(navigator.userAgent || navigator.vendor || window.opera);
    return check;
  }

  /**
   * Get device orientation.
   * @return {string} 'portrait' or 'landscape'.
   */
  getOrientation() {
    if (screen.orientation && screen.orientation.type) {
      if (screen.orientation.type.includes('portrait')) {
        return 'portrait';
      }
      else if (screen.orientation.type.includes('landscape')) {
        return 'landscape';
      }
    }

    // Unreliable, as not clear what device's natural orientation is
    if (typeof window.orientation === 'number') {
      if (window.orientation === 0 || window.orientation === 180) {
        return 'portrait';
      }
      else if (window.orientation === 90 || window.orientation === -90 || window.orientation === 270) {
        return 'landscape';
      }
    }

    return 'landscape'; // Assume default
  }

  /**
	 * Get top DOM Window object.
	 * @param {Window} [startWindow=window] Window to start looking from.
	 * @return {Window|null} Top window.
	 */
  getTopWindow(startWindow) {
    var sameOrigin;
    startWindow = startWindow || window;

    // H5P iframe may be on different domain than iframe content
    try {
      sameOrigin = startWindow.parent.location.host === window.location.host;
    }
    catch (error) {
      sameOrigin = null;
    }

    if (!sameOrigin) {
      return null;
    }

    if (startWindow.parent === startWindow || ! startWindow.parent) {
      return startWindow;
    }

    return this.getTopWindow(startWindow.parent);
  }

  /**
   * Handle orientation change.
   */
  handleOrientationChange() {
    if (!this.params.behaviour.scaleTextNotCard) {
      return;
    }

    const isMobileLandscape = this.isMobileLandscape();
    this.cards.forEach(card => {
      if (this.params.mode === 'repetition') {
        card.$buttonTurn.text(isMobileLandscape ? '' : this.params.answer);
        card.$buttonCorrect.text(isMobileLandscape ? '' : this.params.correctAnswer);
        card.$buttonIncorrect.text(isMobileLandscape ? '' : this.params.incorrectAnswer);
      }

      if (!isMobileLandscape) {
        this.$cardwrapperSet.css('max-height', '');
      }
    });
  }
}

Dialogcards.idCounter = 0;

// Constants
Dialogcards.SCALEINTERVAL = 0.2;
Dialogcards.MAXSCALE = 16;
Dialogcards.MINSCALE = 4;

export default Dialogcards;
